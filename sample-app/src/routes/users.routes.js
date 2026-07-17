const express = require('express');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getMe, getById, update, remove } = require('../controllers/usersController');

const router = express.Router();

router.use(auth);
router.get('/me', asyncHandler(getMe));
router.get('/:id', asyncHandler(getById));
router.put('/:id', asyncHandler(update));
router.delete('/:id', asyncHandler(remove));

module.exports = router;
