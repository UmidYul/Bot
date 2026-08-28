/**
 * Чистая математика "недоплата → внутренний счёт", вынесена отдельно от вебхуков Click/Payme,
 * чтобы её можно было тестировать без БД. currentBalance/paidAmount/price — суммы в UZS.
 * @returns {{grantsAccess: true, newBalance: 0}|{grantsAccess: false, newBalance: number, remaining: number}}
 */
function resolvePaymentOutcome(currentBalance, paidAmount, price) {
  const totalCovered = Number(currentBalance) + Number(paidAmount);

  if (totalCovered >= Number(price)) {
    // Переплата сверх цены нигде не учитывается — просто игнорируется.
    return { grantsAccess: true, newBalance: 0 };
  }

  return { grantsAccess: false, newBalance: totalCovered, remaining: Number(price) - totalCovered };
}

module.exports = { resolvePaymentOutcome };
