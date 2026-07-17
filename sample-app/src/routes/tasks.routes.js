const express = require('express');
const auth = require('../middleware/auth');
const { create, list, getById, update, remove } = require('../controllers/tasksController');

const router = express.Router();

router.use(auth);
router.post('/', create);
router.get('/', list);
router.get('/:id', getById);
router.put('/:id', update);
router.delete('/:id', remove);

module.exports = router;
