import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();
const mongoUrl = process.env.MONGODB_URI || 'mongodb+srv://fitpro:fitpro123@fitpro.txl5u.mongodb.net/fitpro?retryWrites=true&w=majority';

async function verify() {
  try {
    await mongoose.connect(mongoUrl);
    const db = mongoose.connection;
    
    // Check assignment for aniket
    const assignments = await db.collection('dietplanassignments').find({ 
      clientId: new mongoose.Types.ObjectId('69202b504ab4a0b2fb0e5e75')
    }).toArray();
    
    console.log(`\n✓ Diet Plan Assignments for Aniket (69202b504ab4a0b2fb0e5e75):`);
    console.log(`  Found ${assignments.length} assignments`);
    
    for (const a of assignments) {
      const plan = await db.collection('dietplans').findOne({ _id: a.dietPlanId });
      console.log(`  - Plan: ${plan?.name} (ID: ${a.dietPlanId})`);
    }
    
    // Check user record
    const user = await db.collection('users').findOne({ email: /aniket/i });
    console.log(`\n✓ Aniket User Record:`);
    console.log(`  Email: ${user.email}`);
    console.log(`  ClientId: ${user.clientId}`);
    console.log(`  Role: ${user.role}`);
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

verify();
