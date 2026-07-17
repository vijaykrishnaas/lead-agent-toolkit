const express = require('express');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { create, list, getById, update, remove } = require('../controllers/tasksController');

const router = express.Router();

router.use(auth);
router.post('/', asyncHandler(create));
router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(getById));
router.put('/:id', asyncHandler(update));
router.delete('/:id', asyncHandler(remove));

module.exports = router;
