import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
  },
  output: {
    type: String,
    required: true,
  },
  error: {
    type: String,
    required: true,
  },
  exitCode: {
    type: Number,
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Submission = mongoose.model('Submission', submissionSchema);

export default Submission;
