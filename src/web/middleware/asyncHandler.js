/**
 * Express 4 не подхватывает автоматически отклонённые промисы из async-хендлеров —
 * без этой обёртки любая ошибка БД/логики (например, необработанное исключение в запросе)
 * становится unhandledRejection и по умолчанию убивает весь процесс Node, а не просто
 * возвращает 500. Оборачивай в неё каждый async (req, res) => {...} хендлер роута.
 */
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
