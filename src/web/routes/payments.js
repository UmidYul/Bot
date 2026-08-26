const express = require('express');
const click = require('../../payments/click');
const payme = require('../../payments/payme');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post(
  '/click',
  asyncHandler(async (req, res) => {
    try {
      const payload = req.body;
      const action = Number(payload.action);

      // Временно: сырое тело запроса Click (без sign_string) — чтобы при реальной оплате в
      // pm2 logs было видно, что запрос вообще дошёл до Express, ещё до всякой бизнес-логики.
      console.log('[click] POST /payments/click', JSON.stringify({ ...payload, sign_string: undefined }));

      const result =
        action === click.ACTION.COMPLETE ? await click.handleComplete(payload) : await click.handlePrepare(payload);

      const responseBody = {
        click_trans_id: payload.click_trans_id,
        merchant_trans_id: payload.merchant_trans_id,
        ...result,
      };
      console.log('[click] response', JSON.stringify(responseBody));
      res.json(responseBody);
    } catch (err) {
      console.error('Ошибка обработки вебхука Click:', err);
      res.json({ error: -8, error_note: 'Internal error' });
    }
  })
);

router.post(
  '/payme',
  asyncHandler(async (req, res) => {
    const response = await payme.handleRpc(req.headers.authorization, req.body);
    res.json(response);
  })
);

module.exports = router;
