module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.redirect('/admin/login');
};
