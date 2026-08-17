/** Мержит HTML parse_mode с опциональной клавиатурой/другими extra-параметрами ctx.reply. */
function html(extra = {}) {
  return { parse_mode: 'HTML', ...extra };
}

module.exports = { html };
