require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
});

const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    const decodedUser = await admin.auth().verifyIdToken(token);

    req.user = decodedUser; // email, uid, name, picture
    next();
  } catch (error) {
    res.status(403).send({ message: "Forbidden" });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.user.email;
    const query = { email };
    const user = await usersCollection.findOne(query);
    if (!user || user.role !== "admin") {
      return res.status(403).send({ message: "Forbidden" });
    }
    // Admin verified, continue
    next();
  } catch (err) {
    console.error("Admin verification error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

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
    usersCollection = client.db("proFastDB").collection("users");
    ridersCollection = client.db("proFastDB").collection("riders");

    // POST: Add Parcel
    app.post("/parcels", verifyFirebaseToken, async (req, res) => {
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
    // POST: Add Users
    app.post("/users", verifyFirebaseToken, async (req, res) => {
      try {
        const { name, email, photoURL } = req.body;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({ email });

        if (!existingUser) {
          // 🆕 New user (REGISTER)
          const newUser = {
            name,
            email,
            photoURL,
            role: "user",
            createdAt: new Date(),
            lastLoginAt: new Date(),
          };

          await usersCollection.insertOne(newUser);

          return res.json({
            success: true,
            message: "User created",
            type: "register",
          });
        } else {
          // 🔁 Existing user (LOGIN)
          await usersCollection.updateOne(
            { email },
            {
              $set: {
                lastLoginAt: new Date(),
                name,
                photoURL,
              },
            }
          );

          return res.json({
            success: true,
            message: "Login time updated",
            type: "login",
          });
        }
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.post("/riders", verifyFirebaseToken, async (req, res) => {
      try {
        const rider = req.body;

        if (!rider.email || !rider.name) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // ❌ Prevent duplicate application
        const existing = await ridersCollection.findOne({ email: rider.email });
        if (existing) {
          return res
            .status(409)
            .json({ message: "You already applied as a rider" });
        }

        const riderData = {
          ...rider,
          status: "pending",
          createdAt: new Date(),
        };

        const result = await ridersCollection.insertOne(riderData);

        res.status(201).json({
          success: true,
          message: "Rider application submitted",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.get("/users", verifyFirebaseToken, async (req, res) => {
      try {
        const users = await usersCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        res.json({
          success: true,
          data: users,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });

    // Update user role (admin <-> user)
    app.patch(
      "/users/role/:email",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { email } = req.params;
          const { role } = req.body;

          if (!email || !role) {
            return res.status(400).json({ message: "Email and role required" });
          }

          const result = await usersCollection.updateOne(
            { email },
            {
              $set: {
                role,
                roleUpdatedAt: new Date(),
              },
            }
          );

          res.json({
            success: true,
            message: `Role updated to ${role}`,
            result,
          });
        } catch (err) {
          res.status(500).json({ message: err.message });
        }
      }
    );

    app.get("/users/:email", verifyFirebaseToken, async (req, res) => {
      try {
        const { email } = req.params;

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({
          success: true,
          data: user,
        });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.get(
      "/riders/pending",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const riders = await ridersCollection
            .find()
            .sort({ createdAt: -1 })
            .toArray();

          res.json({
            success: true,
            data: riders,
          });
        } catch (error) {
          res.status(500).json({ message: error.message });
        }
      }
    );

    app.get("/riders", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const { status } = req.query;

        const query = status ? { status } : {};
        const riders = await ridersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, data: riders });
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.patch(
      "/riders/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { status } = req.body;

          if (!["approved", "denied", "pending"].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
          }

          const rider = await ridersCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!rider) {
            return res.status(404).json({ message: "Rider not found" });
          }

          // 1️⃣ Update rider status
          await ridersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status,
                reviewedAt: new Date(),
              },
            }
          );

          // 2️⃣ Update user role based on status
          let newRole = "user";

          if (status === "approved") {
            newRole = "rider";
          }

          await usersCollection.updateOne(
            { email: rider.email },
            {
              $set: {
                role: newRole,
                roleUpdatedAt: new Date(),
              },
            }
          );

          res.json({
            success: true,
            message: `Rider ${status} & role set to ${newRole}`,
          });
        } catch (error) {
          res.status(500).json({ message: error.message });
        }
      }
    );

    // POST: Pay to stripe
    app.post(
      "/create-payment-intent",
      verifyFirebaseToken,
      async (req, res) => {
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
      }
    );
    // POST: Add Parcel
    app.post("/payments", verifyFirebaseToken, async (req, res) => {
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

    app.get("/payments", verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.query.email; // optional
        const role = req.query.role; // "admin" | "user"

        const paymentsCollection = client
          .db("proFastDB")
          .collection("payments");

        let query = {};

        // If user → filter by email
        if (role !== "admin" && email) {
          query.customerEmail = email;
        }

        const payments = await paymentsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json({
          success: true,
          count: payments.length,
          data: payments,
        });
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch payments",
        });
      }
    });
    // GET: Get Parcel by email
    app.get("/parcels/:email", verifyFirebaseToken, async (req, res) => {
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
    // GET: Get Parcel by ID
    app.get("/parcel/:id", verifyFirebaseToken, async (req, res) => {
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
    // DELETE: Delete Parcel by ID
    app.delete("/parcels/:id", verifyFirebaseToken, async (req, res) => {
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
