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
    paymentsCollection = client.db("proFastDB").collection("payments");

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
        const { parcelId, customerName, customerEmail } = req.body;

        if (!parcelId) {
          return res.status(400).json({ message: "Parcel ID is required" });
        }

        // 🔐 Always calculate amount from DB
        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(parcelId),
        });

        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: parcel.cost * 100, // cents
          currency: "usd", // use USD unless BDT enabled
          automatic_payment_methods: {
            enabled: true,
          },
          metadata: {
            parcelId: parcel._id.toString(),
            customerName: customerName,
            customerEmail: customerEmail,
          },
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const {
          parcelId,
          paymentIntentId,
          amount,
          customerEmail,
          customerName,
        } = req.body;

        if (!ObjectId.isValid(parcelId)) {
          return res.status(400).json({ message: "Invalid parcel ID" });
        }

        const parcel = await parcelsCollection.findOne({
          _id: new ObjectId(parcelId),
        });

        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        // Prevent duplicate payment
        if (parcel.paymentStatus === "paid") {
          return res.status(400).json({ message: "Parcel already paid" });
        }

        // 1️⃣ Store payment history
        const paymentDoc = {
          parcelId: new ObjectId(parcelId),
          parcelTitle: parcel.title,
          amount,
          currency: "usd",
          paymentIntentId,
          transactionId: paymentIntentId,
          customerName,
          customerEmail,
          status: "succeeded",
          createdAt: new Date(),
        };

        await paymentsCollection.insertOne(paymentDoc);

        // 2️⃣ Update parcel payment status
        await parcelsCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              paymentStatus: "paid",
              transactionId: paymentIntentId,
              paidAt: new Date(),
            },
          }
        );

        res.status(201).json({
          success: true,
          message: "Payment stored successfully",
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.get("/payments/:email", async (req, res) => {
      const payments = await paymentsCollection
        .find({ customerEmail: req.params.email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(payments);
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
