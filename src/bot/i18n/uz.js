module.exports = {
  choose_language: 'Выберите язык / Tilni tanlang:',
  lang_ru: '🇷🇺 Русский',
  lang_uz: "🇺🇿 O'zbekcha",

  welcome: "Xush kelibsiz! Kanalga kirish huquqini rasmiylashtirish uchun telefon raqamingizni ulashing.",
  share_phone_button: '📱 Raqamni ulashish',
  phone_invalid: "Iltimos, quyidagi tugma orqali o'zingizning kontaktingizni yuboring — shunda raqam aynan sizning akkauntingizga bog'lanadi.",
  phone_saved: 'Raqam saqlandi, rahmat!',

  payment_screen: (price) =>
    `Kanalga kirish narxi: ${price} UZS.\n\nAgar promokodingiz bo'lsa — kiriting, yoki to'g'ridan-to'g'ri to'lovga o'ting.`,
  enter_promo_button: '🎟 Promokod kiritish',
  pay_button: "💳 To'lash",
  enter_promo_prompt: 'Promokodni matn sifatida kiriting:',
  promo_invalid: "Promokod amal qilmaydi, muddati o'tgan yoki allaqachon ishlatilgan. Boshqasini sinab ko'ring yoki to'lovga o'ting.",
  promo_applied: (finalAmount) => `Promokod qo'llanildi! Yakuniy summa: ${finalAmount} UZS.`,
  promo_free_access: "Promokod bepul kirish huquqini beradi! Rasmiylashtiryapmiz...",
  back_button: '⬅️ Orqaga',

  choose_payment_method: "To'lov usulini tanlang:",
  pay_click: 'Click',
  pay_payme: 'Payme',
  payment_created: (amount, merchantTransId) =>
    `Hisob yaratildi.\nSumma: ${amount} UZS\nTo'lov raqami: ${merchantTransId}\n\nProvayder ulangach, bu yerda to'lov havolasi paydo bo'ladi.`,
  payment_link: (url) => `To'lash uchun havolaga o'ting:\n${url}`,

  already_paid: "Sizda kanalga kirish huquqi allaqachon bor! Agar havola yo'qolgan bo'lsa, u yana shu yerda:",
  blocked: "Sizning kirish huquqingiz administrator tomonidan bloklangan. Agar bu xato deb hisoblasangiz — qo'llab-quvvatlash xizmatiga murojaat qiling.",

  access_granted: (inviteLink) =>
    `To'lov tasdiqlandi! 🎉\n\nQuyidagi havola orqali «So'rov yuborish» tugmasini bosing — so'rov avtomatik tasdiqlanadi:\n${inviteLink}`,
  join_welcome: 'Kanalga xush kelibsiz! 🎉',
  join_need_payment: "Avval to'lovni amalga oshirish kerak. To'lovni rasmiylashtirish uchun shu chatda /start ni yuboring.",

  your_code: (code) => `Sizning shaxsiy kodingiz: ${code}\nU bank ilovasi orqali qo'lda to'lov qilsangiz kerak bo'ladi.`,

  generic_error: "Nimadir xato ketdi. Qaytadan urinib ko'ring yoki /start ni qayta yuboring.",
};
