const express = require('express');
const auth = require('../middleware/auth');
const { getMe, getById, update, remove } = require('../controllers/usersController');

const router = express.Router();

router.use(auth);
router.get('/me', getMe);
router.get('/:id', getById);
router.put('/:id', update);
router.delete('/:id', remove);

module.exports = router;
