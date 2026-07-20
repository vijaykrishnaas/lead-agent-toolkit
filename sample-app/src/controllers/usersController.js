const User = require('../models/User');

async function getMe(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(200).json({ id: user._id, name: user.name, email: user.email });
}

async function getById(req, res) {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Cannot view another user' });
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(200).json({ id: user._id, name: user.name, email: user.email });
}

async function update(req, res) {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Cannot modify another user' });
  }
  const { name, email } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { ...(name && { name }), ...(email && { email }) } },
      { new: true, runValidators: true },
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({ id: user._id, name: user.name, email: user.email });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    throw err;
  }
}

async function remove(req, res) {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Cannot delete another user' });
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.status(204).send();
}

module.exports = { getMe, getById, update, remove };
