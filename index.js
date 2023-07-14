import express from "express";
import { spawn } from "child_process";
import connectDB from "./db.js";
import Submission from "./Submission.js";
import { User } from "./User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import { VM } from "vm2";
import cluster from 'cluster';

const numCPUs = require('os').cpus().length;

const app = express();
app.use(express.json());

// Connect to MongoDB
connectDB();

// Generate JWT token
function generateToken(user) {
  return jwt.sign({ userId: user._id }, "your_secret_key", {
    expiresIn: "1h",
  });
}

// Endpoint for user registration
app.post(
  "/register",
  body("username").notEmpty().withMessage("Username is required"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      // Check if the username already exists
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create a new user
      const user = new User({
        username,
        password: hashedPassword,
      });

      // Save the user to the database
      await user.save();

      // Generate a JWT token
      const token = generateToken(user);

      res.status(201).json({ message: "User registered successfully", token });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Endpoint for user login
app.post(
  "/login",
  body("username").notEmpty().withMessage("Username is required"),
  body("password").notEmpty().withMessage("Password is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      // Find the user by username
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Compare passwords
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ message: "Invalid password" });
      }

      // Generate a JWT token
      const token = generateToken(user);

      res.status(200).json({ message: "Login successful", token });
    } catch (error) {
      console.error("Error logging in user:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

// Middleware for authentication
function authenticate(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, "your_secret_key", (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.userId = decoded.userId;
    next();
  });
}

const sandboxConfig = {
  timeout: 1000, // Set the time limit to 1 second
  sandbox: {
    // Restrict access to certain modules
    require: {
      external: true, // Allow access to external modules
      builtin: ["fs", "path"], // Allow access to specific built-in modules
    },
    // Set resource limits (e.g., memory usage, CPU usage)
    // ...
  },
};

// Endpoint for submitting code
app.post(
  "/submit",
  authenticate,
  body("code").notEmpty().withMessage("Code is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const code = req.body.code;
    const userId = req.userId;

    // Execute the code using a child process
    const childProcess = spawn("node", ["-e", code]);

    let output = "";
    let error = "";

    childProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      error += data.toString();
    });

    childProcess.on("close", async (code) => {
      const submission = new Submission({
        code: code,
        output: output,
        error: error,
        exitCode: code,
        user: userId,
      });

      try {
        // Save the submission to the database
        await submission.save();
        console.log("Submission saved to the database");
      } catch (error) {
        console.error("Error saving submission:", error);
      }

      const result = {
        output: output,
        error: error,
        exitCode: code,
      };

      // Send the result as the response
      res.json(result);
    });
  }
);
// Endpoint for code execution
app.post(
  "/execute",
  authenticate,
  body("language").notEmpty().withMessage("Language is required"),
  body("code").notEmpty().withMessage("Code is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { language, code } = req.body;
    const userId = req.userId;
    // Execute the user-submitted code within the secure sandbox environment
    const sandbox = new VM(sandboxConfig);

    sandbox.run(code, (output) => {
      // Handle the output of the executed code and send it as the response
      res.json({ output });
    });
    // Execute the code using a child process
    const childProcess = spawn(getCommandForLanguage(language), ["-e", code]);

    let output = "";
    let error = "";

    childProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      error += data.toString();
    });

    childProcess.on("close", async (code) => {
      const submission = new Submission({
        language: language,
        code: code,
        output: output,
        error: error,
        exitCode: code,
        user: userId,
      });

      try {
        // Save the submission to the database
        await submission.save();
        console.log("Submission saved to the database");
      } catch (error) {
        console.error("Error saving submission:", error);
      }

      const result = {
        output: output,
        error: error,
        exitCode: code,
      };

      // Send the result as the response
      res.json(result);
    });
  }
);

// Helper function to get the command for the given language
function getCommandForLanguage(language) {
  switch (language) {
    case "javascript":
      return "node";
    case "python":
      return "python";
    // Add more cases for other supported languages
    default:
      throw new Error("Unsupported language");
  }
}

// Endpoint for retrieving submission results
app.get("/submissions", authenticate, async (req, res) => {
  try {
    const userId = req.userId;

    // Retrieve all submissions for the user
    const submissions = await Submission.find({ user: userId });

    res.json(submissions);
  } catch (error) {
    console.error("Error retrieving submissions:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

// Start the server
if (cluster.isMaster) {
  // Fork worker processes based on the number of CPUs
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  // Code for individual worker process
  // Place your existing code here
  app.listen(3000, () => {
    console.log('Server started on port 3000');
  });
}

// Restart the worker process if it crashes
cluster.on('exit', (worker, code, signal) => {
  console.log(`Worker ${worker.process.pid} died. Restarting...`);
  cluster.fork();
});