const db = require('../index');

function log({ adminId, action, targetUserId = null, meta = null }) {
  return db('admin_logs').insert({
    admin_id: adminId,
    action,
    target_user_id: targetUserId,
    meta: meta ? JSON.stringify(meta) : null,
  });
}

async function list({ adminId, action, targetUserId, page = 1, pageSize = 30 } = {}) {
  const base = db('admin_logs as l')
    .leftJoin('admins as a', 'a.id', 'l.admin_id')
    .leftJoin('users as u', 'u.id', 'l.target_user_id');

  if (adminId) base.andWhere('l.admin_id', adminId);
  if (action) base.andWhere('l.action', action);
  if (targetUserId) base.andWhere('l.target_user_id', targetUserId);

  const countRow = await base.clone().count({ count: 'l.id' }).first();
  const total = parseInt(countRow.count, 10);

  const rows = await base
    .clone()
    .select(
      'l.*',
      'a.login as admin_login',
      'u.code as target_user_code',
      'u.username as target_username'
    )
    .orderBy('l.created_at', 'desc')
    .limit(pageSize)
    .offset((Math.max(1, page) - 1) * pageSize);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { log, list };
