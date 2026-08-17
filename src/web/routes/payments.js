const express = require('express');
const click = require('../../payments/click');
const payme = require('../../payments/payme');

const router = express.Router();

router.post('/click', async (req, res) => {
  try {
    const payload = req.body;
    const action = Number(payload.action);

    const result =
      action === click.ACTION.COMPLETE ? await click.handleComplete(payload) : await click.handlePrepare(payload);

    res.json({
      click_trans_id: payload.click_trans_id,
      merchant_trans_id: payload.merchant_trans_id,
      ...result,
    });
  } catch (err) {
    console.error('Ошибка обработки вебхука Click:', err);
    res.json({ error: -8, error_note: 'Internal error' });
  }
});

router.post('/payme', async (req, res) => {
  const response = await payme.handleRpc(req.headers.authorization, req.body);
  res.json(response);
});

module.exports = router;
