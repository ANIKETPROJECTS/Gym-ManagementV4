const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config();

const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/fitpro';

async function deletePlan() {
  try {
    await mongoose.connect(mongoUrl);
    console.log('✓ Connected to MongoDB');

    // Load models
    const WorkoutPlanModel = require('./server/models').WorkoutPlan;
    const ClientModel = require('./server/models').Client;
    const WorkoutBookmarkModel = require('./server/models').WorkoutBookmark;
    const WorkoutNoteModel = require('./server/models').WorkoutNote;
    const WorkoutSessionModel = require('./server/models').WorkoutSession;

    // Find Aniket
    const aniket = await ClientModel.findOne({ 
      $or: [
        { name: { $regex: 'aniket', $options: 'i' } },
        { email: { $regex: 'aniket', $options: 'i' } }
      ]
    });

    if (!aniket) {
      console.log('✗ Aniket not found');
      await mongoose.connection.close();
      process.exit(1);
    }

    console.log(`✓ Found Aniket: ${aniket.name}`);

    // Find workout plans
    const plans = await WorkoutPlanModel.find({ clientId: aniket._id });
    console.log(`✓ Found ${plans.length} workout plans`);

    if (plans.length === 0) {
      console.log('✗ No plans to delete');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Delete most recent plan
    const plan = plans[plans.length - 1];
    console.log(`🗑️  Deleting: "${plan.name}" (${plan._id})`);

    // Delete related data
    await WorkoutBookmarkModel.deleteMany({ planId: plan._id });
    await WorkoutNoteModel.deleteMany({ planId: plan._id });
    await WorkoutSessionModel.deleteMany({ workoutPlanId: plan._id });
    await WorkoutPlanModel.deleteOne({ _id: plan._id });

    console.log('✅ Plan and all related data deleted successfully!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

deletePlan();
