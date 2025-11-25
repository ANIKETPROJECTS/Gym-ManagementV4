import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/fitpro';

async function deletePlan() {
  try {
    await mongoose.connect(mongoUrl);
    console.log('✓ Connected to MongoDB');

    // Load models dynamically
    const { WorkoutPlan, Client, WorkoutBookmark, WorkoutNote, WorkoutSession } = await import('./server/models.ts');

    // Find Aniket
    const aniket = await Client.findOne({ 
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
    const plans = await WorkoutPlan.find({ clientId: aniket._id });
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
    await WorkoutBookmark.deleteMany({ planId: plan._id });
    await WorkoutNote.deleteMany({ planId: plan._id });
    await WorkoutSession.deleteMany({ workoutPlanId: plan._id });
    await WorkoutPlan.deleteOne({ _id: plan._id });

    console.log('✅ Aniket\'s workout plan deleted successfully!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

deletePlan();
