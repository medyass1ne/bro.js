import { defineConfig } from 'bro-framework';

export default defineConfig({
  // Server Settings
  server: {
    port: 5000,
    cors: true // Set to true to allow all, or pass a CORS options object
  },

  // Authentication Settings
  auth: {
    jwtSecret: 'dev_secret_please_change',
    expiresIn: '7d'
  },
  
  // API Documentation (Scalar UI)
  docs: process.env.NODE_ENV !== 'production', // Set to false to disable completely, or true to force in prod

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },

  // WebSockets Setup
  sockets: async (io, db) => {
    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
    });
  },

  // Database Context Injection
  // This instance will be injected into every route's ctx.db (if defined)
  db: async () => {
    // If you use a database, set up your connection here
    // and return the connection instance or an object of your models.
    // Could be MongoDB, MySQL, etc. (your choice)
    // --- MONGOOSE EXAMPLE ---
    // import mongoose from 'mongoose';
    
    // await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bro_database');
    // console.log("Connected to MongoDB");
    
    // You can return mongoose itself, or an object of your models 
    // to access them instantly in your routes without importing them!
    // Example: return { User, Post };
    
    // return mongoose.connection; 
    // --------------------------
    return null;
  }
});
