const Task = require('../models/Task');

// req.body fields are attacker-controlled JSON values, not guaranteed strings;
// a blank or wrong-typed title would otherwise reach Mongoose and be stored
// (whitespace, numbers coerced to strings) or surface as a driver error.
function isValidTitle(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function create(req, res) {
  const { title, description } = req.body;
  if (!isValidTitle(title)) {
    return res.status(400).json({ error: 'title is required' });
  }
  const task = await Task.create({ title, description, owner: req.user.id });
  return res.status(201).json(task);
}

async function list(req, res) {
  const tasks = await Task.find({ owner: req.user.id });
  return res.status(200).json(tasks);
}

async function getById(req, res) {
  const task = await Task.findOne({ _id: req.params.id, owner: req.user.id });
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.status(200).json(task);
}

async function update(req, res) {
  const { title, description, completed } = req.body;
  if (title !== undefined && !isValidTitle(title)) {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, owner: req.user.id },
    { $set: { ...(title !== undefined && { title }), ...(description !== undefined && { description }), ...(completed !== undefined && { completed }) } },
    { new: true, runValidators: true },
  );
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.status(200).json(task);
}

async function remove(req, res) {
  const task = await Task.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.status(204).send();
}

module.exports = { create, list, getById, update, remove };
