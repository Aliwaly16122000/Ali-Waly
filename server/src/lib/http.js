export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra; // machine-readable fields merged into the JSON error body
  }
}

export const badRequest = (msg = 'طلب غير صالح', extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'غير مسموح لك بهذا الإجراء') => new HttpError(403, msg);
export const notFound = (msg = 'العنصر غير موجود') => new HttpError(404, msg);

/** Wraps an async route handler so thrown errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parses a request body with a zod schema, turning validation failures into a 400. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw badRequest(field ? `${field}: ${issue.message}` : issue.message);
  }
  return result.data;
}

export const toId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('معرّف غير صالح');
  return id;
};
