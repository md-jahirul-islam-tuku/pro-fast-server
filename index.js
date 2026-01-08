require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

// pro-fast-project
// kO1RtKn28qIV2ktx

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dvetdgy.mongodb.net/proFastDB?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let parcelsCollection;

async function run() {
  try {
    await client.connect();
    console.log("✅ MongoDB Connected");

    parcelsCollection = client.db("proFastDB").collection("parcels");

    // =============================
    // POST: Add Parcel
    // =============================
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = req.body;

        if (!parcel.title || !parcel.parcelType) {
          return res.status(400).json({
            success: false,
            message: "Parcel title and type are required",
          });
        }

        // parcel.status = "pending";
        // parcel.createdAt = new Date();

        const result = await parcelsCollection.insertOne(parcel);

        res.status(201).json({
          success: true,
          message: "Parcel added successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Failed to add parcel",
          error: error.message,
        });
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amount } = req.body; // amount in cents

        if (!amount) {
          return res.status(400).json({ message: "Amount is required" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100, // e.g. 500 = ৳5.00 (or $5)
          currency: "usd", // or "bdt" if supported
          payment_method_types: ["card"],
        });

        res.json({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.get("/parcels/:email", async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).json({
            success: false,
            message: "Email is required",
          });
        }

        const parcels = await parcelsCollection
          .find({ senderEmail: email })
          .sort({ createdAt: -1 }) // 🔥 newest first
          .toArray();

        res.status(200).json({
          success: true,
          data: parcels,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({
          success: false,
          message: "Failed to fetch parcels",
        });
      }
    });

    app.get("/parcel/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // 🔒 Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid parcel ID",
          });
        }

        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).json({
            success: false,
            message: "Parcel not found",
          });
        }

        res.status(200).json({
          success: true,
          data: parcel,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({
          success: false,
          message: "Server error",
        });
      }
    });

    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const result = await parcelsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.json({ success: true, message: "Parcel deleted" });
      } catch (err) {
        res.status(500).json({ message: "Delete failed" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("📡 MongoDB Ping successful");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
  }
}
run();

app.get("/", (req, res) => {
  res.send("ProFast server is here");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port: ${port}`);
});
