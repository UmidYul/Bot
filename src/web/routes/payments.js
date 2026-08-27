const express = require('express');
const payme = require('../../payments/payme');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post(
  '/payme',
  asyncHandler(async (req, res) => {
    const response = await payme.handleRpc(req.headers.authorization, req.body);
    res.json(response);
  })
);

module.exports = router;
