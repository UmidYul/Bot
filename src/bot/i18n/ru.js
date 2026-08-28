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
    `<b>Доступ к закрытому каналу</b>\n\nСтоимость: <b>${formatAmount(price)} UZS</b>\n\nЕсли у вас есть промокод — используйте кнопку "Ввести промокод" в меню. Либо сразу переходите к оплате.`,
  enter_promo_button: '🎟 Ввести промокод',
  pay_button: '💳 Оплатить',
  enter_promo_prompt: 'Введите промокод одним сообщением:',
  cancel_button: '✖️ Отмена',
  promo_invalid: '⚠️ Промокод недействителен, истёк или уже использован. Попробуйте другой или переходите к оплате.',
  promo_locked: (minutes) => `🚫 Слишком много неверных попыток. Попробуйте ввести промокод снова через ${minutes} мин.`,
  promo_applied: (finalAmount) => `✅ Промокод применён! Итоговая сумма: <b>${formatAmount(finalAmount)} UZS</b>.`,
  promo_free_access: '🎉 Промокод даёт бесплатный доступ! Оформляем...',
  back_button: '⬅️ Назад',

  choose_payment_method: 'Выберите способ оплаты:',
  pay_click: '💳 Click',
  pay_payme: '💳 Payme',
  pay_admin: '👤 Оплата через администратора',
  provider_disabled: 'Этот способ оплаты сейчас недоступен. Пожалуйста, выберите другой на экране оплаты.',
  payment_created: (amount, merchantTransId) =>
    `<b>Счёт создан</b>\nСумма: <b>${formatAmount(amount)} UZS</b>\nНомер платежа: <code>${merchantTransId}</code>\n\nСсылка на оплату появится здесь после подключения провайдера.`,
  payment_link_prompt: 'Нажмите кнопку ниже, чтобы перейти к оплате:',
  pay_open_button: '💳 Перейти к оплате',

  receipt_title: '🧾 <b>Квитанция об оплате</b>',
  receipt_amount_label: 'Сумма',
  receipt_provider_label: 'Способ оплаты',
  receipt_id_label: 'Номер платежа',
  receipt_date_label: 'Дата',
  receipt_promo_label: 'Промокод',

  underpayment_notice: (paid, remaining) =>
    `Оплата получена: <b>${formatAmount(paid)} UZS</b>.\nДо получения доступа не хватает: <b>${formatAmount(remaining)} UZS</b>.`,
  topup_button: '💳 Доплатить',

  provider_click: 'Click',
  provider_payme: 'Payme',
  provider_promo: 'Промокод (бесплатно)',

  already_paid: '✅ У вас уже есть доступ к каналу. Если ссылка потерялась — вот она снова:',
  blocked: '🚫 Ваш доступ заблокирован администратором. Если считаете это ошибкой — свяжитесь с поддержкой.',
  account_deleted: '🚫 Ваш аккаунт удалён администратором. Если считаете это ошибкой — свяжитесь с поддержкой.',

  access_granted: (inviteLink) =>
    `<b>Оплата подтверждена!</b> 🎉\n\nНажмите «Подать заявку» по ссылке ниже — заявка будет одобрена автоматически:\n${inviteLink}`,
  open_channel_button: '➡️ Открыть канал',
  join_welcome: 'Добро пожаловать в канал! 🎉',
  join_need_payment: 'Сначала нужно оплатить доступ. Отправьте /start в этом чате, чтобы оформить оплату.',

  menu_profile: '👤 Профиль',
  menu_pay: '💳 Оплата',
  menu_language: '🌐 Язык',
  menu_more: 'ℹ️ Подробнее',
  menu_admin: '🛠 Админ',
  menu_prompt: 'Выберите действие в меню ниже 👇',

  profile_title: '👤 <b>Ваш профиль</b>',
  profile_code_label: '🆔 Код (лицевой счёт)',
  profile_phone_label: '📱 Телефон',
  profile_phone_missing: 'не указан',
  profile_language_label: '🌐 Язык',
  profile_status_label: '📌 Статус',
  profile_registered_label: '📅 Регистрация',
  profile_last_payment_label: '💳 Последний платёж',
  profile_no_payments: 'платежей ещё не было',

  status_new: '🆕 новый',
  status_pending: '⏳ ожидает оплаты',
  status_paid: '✅ оплачен',
  status_blocked: '🚫 заблокирован',

  admin_text: (username) => `По всем вопросам обращайтесь к администратору: @${username}`,
  more_text: (url) => `Наш другой канал: ${url}`,

  need_phone_first: 'Сначала поделитесь номером телефона — нажмите кнопку ниже.',

  your_code: (code) => `Ваш личный код: <b><code>${code}</code></b>\nОн понадобится, если будете оплачивать вручную через приложение банка.`,

  generic_error: '⚠️ Что-то пошло не так. Попробуйте ещё раз или отправьте /start заново.',
  unrecognized_message: 'Не совсем понял 🙂 Воспользуйтесь меню ниже или отправьте /start.',
};

function formatAmount(amount) {
  return Number(amount).toLocaleString('ru-RU');
}
