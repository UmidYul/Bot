module.exports = {
  choose_language: 'Interfeys tilini tanlang:',
  lang_ru: '🇷🇺 Русский',
  lang_uz: "🇺🇿 O'zbekcha",
  language_changed: "✅ Til o'zbekchaga o'zgartirildi.",

  welcome: "Xush kelibsiz! 👋\n\nKanalga kirish huquqini rasmiylashtirish uchun telefon raqamingizni ulashing — pastdagi tugmani bosing.",
  share_phone_button: '📱 Raqamni ulashish',
  phone_invalid: "Xato: iltimos, aynan o'zingizning kontaktingizni pastdagi tugma orqali yuboring — shunda raqam sizning akkauntingizga bog'lanadi.",
  phone_saved: '✅ Raqam saqlandi, rahmat!',

  payment_screen: (price) =>
    `<b>Yopiq kanalga kirish</b>\n\nNarxi: <b>${formatAmount(price)} UZS</b>\n\nAgar promokodingiz bo'lsa — kiriting. Yoki to'g'ridan-to'g'ri to'lovga o'ting.`,
  enter_promo_button: '🎟 Promokod kiritish',
  pay_button: "💳 To'lash",
  enter_promo_prompt: 'Promokodni bitta xabar sifatida kiriting:',
  cancel_button: '✖️ Bekor qilish',
  promo_cancelled: 'Promokod kiritish bekor qilindi.',
  promo_invalid: "⚠️ Promokod amal qilmaydi, muddati o'tgan yoki allaqachon ishlatilgan. Boshqasini sinab ko'ring yoki to'lovga o'ting.",
  promo_locked: (minutes) => `🚫 Juda ko'p noto'g'ri urinish. Promokodni ${minutes} daqiqadan so'ng qaytadan kiriting.`,
  promo_applied: (finalAmount) => `✅ Promokod qo'llanildi! Yakuniy summa: <b>${formatAmount(finalAmount)} UZS</b>.`,
  promo_free_access: "🎉 Promokod bepul kirish huquqini beradi! Rasmiylashtiryapmiz...",
  back_button: '⬅️ Orqaga',

  choose_payment_method: "To'lov usulini tanlang:",
  pay_click: '💳 Click',
  pay_payme: '💳 Payme',
  pay_balance: (balance) => `💰 Mening hisobim (${formatAmount(balance)} UZS)`,
  payme_disabled: "Payme vaqtincha mavjud emas. Iltimos, Click orqali to'lang.",
  payment_created: (amount, merchantTransId) =>
    `<b>Hisob yaratildi</b>\nSumma: <b>${formatAmount(amount)} UZS</b>\nTo'lov raqami: <code>${merchantTransId}</code>\n\nProvayder ulangach, bu yerda to'lov havolasi paydo bo'ladi.`,
  payment_link: (url) => `To'lash uchun havolaga o'ting:\n${url}`,
  cancel_payment_prompt: "Fikringizdan qaytsangiz — bekor qilib, boshqa usulni tanlashingiz mumkin.",
  payment_cancelled: "To'lov bekor qilindi. Boshqa usulni tanlashingiz mumkin.",

  balance_insufficient: (balance, needed, shortfall) =>
    `⚠️ Hisobingizda mablag' yetarli emas.\n\nBalans: <b>${formatAmount(balance)} UZS</b>\nKerak: <b>${formatAmount(needed)} UZS</b>\nYetishmayapti: <b>${formatAmount(shortfall)} UZS</b>\n\nBalansni to'ldirish uchun Click yoki Payme ilovasini to'g'ridan-to'g'ri oching va kodingizni kiriting (/profile ga qarang).`,
  balance_topped_up: (amount, newBalance) =>
    `💰 <b>Balans ${formatAmount(amount)} UZS ga to'ldirildi</b>\nJoriy balans: <b>${formatAmount(newBalance)} UZS</b>\n\nKanalga kirish huquqini olish uchun menyuga qaytib, «Mening hisobim» to'lov usulini tanlang.`,

  invoice_title: 'Kanalga kirish',
  invoice_description: "Yopiq kanalga kirish huquqi uchun to'lov",
  invoice_price_label: 'Kanalga kirish',
  pre_checkout_order_not_found: "Buyurtma topilmadi yoki allaqachon qayta ishlangan. /start orqali to'lovni qaytadan boshlang.",
  pre_checkout_amount_mismatch: "To'lov summasi buyurtma summasiga mos kelmaydi.",
  payment_success: "✅ To'lov qabul qilindi, rahmat!",

  receipt_title: "🧾 <b>To'lov kvitansiyasi</b>",
  receipt_amount_label: 'Summa',
  receipt_provider_label: "To'lov usuli",
  receipt_id_label: "To'lov raqami",
  receipt_date_label: 'Sana',
  receipt_promo_label: 'Promokod',
  provider_click: 'Click',
  provider_payme: 'Payme',
  provider_balance: 'Mening hisobim',
  provider_promo: 'Promokod (bepul)',

  already_paid: "✅ Sizda kanalga kirish huquqi allaqachon bor. Agar havola yo'qolgan bo'lsa, u yana shu yerda:",
  blocked: "🚫 Sizning kirish huquqingiz administrator tomonidan bloklangan. Agar bu xato deb hisoblasangiz — qo'llab-quvvatlash xizmatiga murojaat qiling.",

  access_granted: (inviteLink) =>
    `<b>To'lov tasdiqlandi!</b> 🎉\n\nQuyidagi havola orqali «So'rov yuborish» tugmasini bosing — so'rov avtomatik tasdiqlanadi:\n${inviteLink}`,
  open_channel_button: '➡️ Kanalni ochish',
  join_welcome: 'Kanalga xush kelibsiz! 🎉',
  join_need_payment: "Avval to'lovni amalga oshirish kerak. To'lovni rasmiylashtirish uchun shu chatda /start ni yuboring.",

  menu_profile: '👤 Profil',
  menu_pay: "💳 To'lov",
  menu_language: '🌐 Til',
  menu_help: '❓ Yordam',
  menu_prompt: "Pastdagi menyudan amalni tanlang 👇",

  profile_title: '👤 <b>Sizning profilingiz</b>',
  profile_code_label: '🆔 Kod (hisob raqami)',
  profile_phone_label: '📱 Telefon',
  profile_phone_missing: "ko'rsatilmagan",
  profile_language_label: '🌐 Til',
  profile_status_label: '📌 Holat',
  profile_registered_label: "📅 Ro'yxatdan o'tgan",
  profile_balance_label: '💰 Balans',
  profile_last_payment_label: "💳 Oxirgi to'lov",
  profile_no_payments: "hali to'lovlar yo'q",

  status_new: '🆕 yangi',
  status_pending: "⏳ to'lov kutilmoqda",
  status_paid: "✅ to'langan",
  status_blocked: '🚫 bloklangan',

  help_text:
    "<b>Botdan qanday foydalanish kerak</b>\n\n" +
    "/start — boshlash / asosiy menyuga qaytish\n" +
    "/profile — profilingiz va qo'lda to'lov uchun kod\n" +
    "/help — shu yordam matni\n\n" +
    "Ekran pastidagi menyu tugmalari komandalar bilan bir xil ishlaydi. Agar biror narsa noto'g'ri ketsa — shunchaki /start yuboring.\n\n" +
    "💡 Profildagi kodni Click ilovasi orqali balansni to'g'ridan-to'g'ri to'ldirish uchun ishlatishingiz mumkin — uni hisob raqami sifatida kiriting. Balans avtomatik to'ldiriladi, keyin botda «Mening hisobim» to'lov usuli orqali kirish huquqini olishingiz mumkin.",

  need_phone_first: 'Avval telefon raqamingizni ulashing — pastdagi tugmani bosing.',

  your_code: (code) => `Sizning shaxsiy kodingiz: <code>${code}</code>\nU bank ilovasi orqali qo'lda to'lov qilsangiz kerak bo'ladi.`,

  generic_error: "⚠️ Nimadir xato ketdi. Qaytadan urinib ko'ring yoki /start ni qayta yuboring.",
  unrecognized_message: "Tushunmadim 🙂 Pastdagi menyudan foydalaning yoki /start yuboring.",
};

function formatAmount(amount) {
  return Number(amount).toLocaleString('ru-RU');
}
