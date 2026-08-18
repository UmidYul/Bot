module.exports = {
  choose_language: 'Выберите язык интерфейса:',
  lang_ru: '🇷🇺 Русский',
  lang_uz: "🇺🇿 O'zbekcha",
  language_changed: '✅ Язык переключён на русский.',

  welcome:
    'Добро пожаловать! 👋\n\nЧтобы оформить доступ к каналу, поделитесь, пожалуйста, своим номером телефона — нажмите кнопку ниже.',
  share_phone_button: '📱 Поделиться номером',
  phone_invalid:
    'Не получилось: пришлите, пожалуйста, именно свой контакт кнопкой ниже — так номер точно привяжется к вашему аккаунту.',
  phone_saved: '✅ Номер сохранён, спасибо!',

  payment_screen: (price) =>
    `<b>Доступ к закрытому каналу</b>\n\nСтоимость: <b>${formatAmount(price)} UZS</b>\n\nЕсли у вас есть промокод — введите его. Либо сразу переходите к оплате.`,
  enter_promo_button: '🎟 Ввести промокод',
  pay_button: '💳 Оплатить',
  enter_promo_prompt: 'Введите промокод одним сообщением:',
  cancel_button: '✖️ Отмена',
  promo_cancelled: 'Ввод промокода отменён.',
  promo_invalid: '⚠️ Промокод недействителен, истёк или уже использован. Попробуйте другой или переходите к оплате.',
  promo_locked: (minutes) => `🚫 Слишком много неверных попыток. Попробуйте ввести промокод снова через ${minutes} мин.`,
  promo_applied: (finalAmount) => `✅ Промокод применён! Итоговая сумма: <b>${formatAmount(finalAmount)} UZS</b>.`,
  promo_free_access: '🎉 Промокод даёт бесплатный доступ! Оформляем...',
  back_button: '⬅️ Назад',

  choose_payment_method: 'Выберите способ оплаты:',
  pay_click: '💳 Click',
  pay_payme: '💳 Payme',
  pay_balance: (balance) => `💰 Мой счёт (${formatAmount(balance)} UZS)`,
  provider_disabled: 'Этот способ оплаты сейчас недоступен. Пожалуйста, выберите другой на экране оплаты.',
  payment_created: (amount, merchantTransId) =>
    `<b>Счёт создан</b>\nСумма: <b>${formatAmount(amount)} UZS</b>\nНомер платежа: <code>${merchantTransId}</code>\n\nСсылка на оплату появится здесь после подключения провайдера.`,
  payment_link: (url) => `Для оплаты перейдите по ссылке:\n${url}`,
  cancel_payment_prompt: 'Если передумали — можно отменить и выбрать другой способ.',
  payment_cancelled: 'Оплата отменена. Можно выбрать другой способ.',

  balance_insufficient: (balance, needed, shortfall) =>
    `⚠️ На балансе недостаточно средств.\n\nБаланс: <b>${formatAmount(balance)} UZS</b>\nНужно: <b>${formatAmount(needed)} UZS</b>\nНе хватает: <b>${formatAmount(shortfall)} UZS</b>\n\nПополнить баланс можно, открыв приложение Click или Payme напрямую и введя там свой код (смотрите /profile).`,
  balance_topped_up: (amount, newBalance) =>
    `💰 <b>Баланс пополнен на ${formatAmount(amount)} UZS</b>\nТекущий баланс: <b>${formatAmount(newBalance)} UZS</b>\n\nЧтобы получить доступ к каналу, вернитесь в меню и выберите способ оплаты «Мой счёт».`,
  balance_adjusted_by_admin: (amount, newBalance, reason) =>
    `${amount > 0 ? '💰' : '⚠️'} <b>Администратор ${amount > 0 ? 'пополнил ваш баланс на' : 'списал с вашего баланса'} ${formatAmount(Math.abs(amount))} UZS</b>${reason ? `\nПричина: ${reason}` : ''}\nТекущий баланс: <b>${formatAmount(newBalance)} UZS</b>`,

  invoice_title: 'Доступ к каналу',
  invoice_description: 'Оплата доступа к закрытому каналу',
  invoice_price_label: 'Доступ к каналу',
  pre_checkout_order_not_found: 'Заказ не найден или уже обработан. Начните оплату заново через /start.',
  pre_checkout_amount_mismatch: 'Сумма платежа не совпадает с суммой заказа.',
  payment_success: '✅ Оплата получена, спасибо!',

  receipt_title: '🧾 <b>Квитанция об оплате</b>',
  receipt_amount_label: 'Сумма',
  receipt_provider_label: 'Способ оплаты',
  receipt_id_label: 'Номер платежа',
  receipt_date_label: 'Дата',
  receipt_promo_label: 'Промокод',
  provider_click: 'Click',
  provider_payme: 'Payme',
  provider_balance: 'Мой счёт',
  provider_promo: 'Промокод (бесплатно)',

  already_paid: '✅ У вас уже есть доступ к каналу. Если ссылка потерялась — вот она снова:',
  blocked: '🚫 Ваш доступ заблокирован администратором. Если считаете это ошибкой — свяжитесь с поддержкой.',

  access_granted: (inviteLink) =>
    `<b>Оплата подтверждена!</b> 🎉\n\nНажмите «Подать заявку» по ссылке ниже — заявка будет одобрена автоматически:\n${inviteLink}`,
  open_channel_button: '➡️ Открыть канал',
  join_welcome: 'Добро пожаловать в канал! 🎉',
  join_need_payment: 'Сначала нужно оплатить доступ. Отправьте /start в этом чате, чтобы оформить оплату.',

  menu_profile: '👤 Профиль',
  menu_pay: '💳 Оплата',
  menu_language: '🌐 Язык',
  menu_help: '❓ Помощь',
  menu_prompt: 'Выберите действие в меню ниже 👇',

  profile_title: '👤 <b>Ваш профиль</b>',
  profile_code_label: '🆔 Код (лицевой счёт)',
  profile_phone_label: '📱 Телефон',
  profile_phone_missing: 'не указан',
  profile_language_label: '🌐 Язык',
  profile_status_label: '📌 Статус',
  profile_registered_label: '📅 Регистрация',
  profile_balance_label: '💰 Баланс',
  profile_last_payment_label: '💳 Последний платёж',
  profile_no_payments: 'платежей ещё не было',

  status_new: '🆕 новый',
  status_pending: '⏳ ожидает оплаты',
  status_paid: '✅ оплачен',
  status_blocked: '🚫 заблокирован',

  help_text:
    '<b>Как пользоваться ботом</b>\n\n' +
    '/start — начать / вернуться в главное меню\n' +
    '/profile — ваш профиль и код для ручной оплаты\n' +
    '/help — эта справка\n\n' +
    'Кнопки меню внизу экрана работают так же, как команды. Если что-то пошло не так — просто отправьте /start.\n\n' +
    '💡 Код из профиля можно использовать, чтобы пополнить баланс напрямую через приложение Click — впишите его как номер лицевого счёта. Баланс зачислится автоматически, а доступ потом можно получить в боте способом оплаты «Мой счёт».',

  need_phone_first: 'Сначала поделитесь номером телефона — нажмите кнопку ниже.',

  your_code: (code) => `Ваш личный код: <code>${code}</code>\nОн понадобится, если будете оплачивать вручную через приложение банка.`,

  generic_error: '⚠️ Что-то пошло не так. Попробуйте ещё раз или отправьте /start заново.',
  unrecognized_message: 'Не совсем понял 🙂 Воспользуйтесь меню ниже или отправьте /start.',
};

function formatAmount(amount) {
  return Number(amount).toLocaleString('ru-RU');
}
