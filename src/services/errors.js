// Error tipado que un service lanza cuando algo sale mal por una razón conocida
// (validación, no encontrado, conflicto). El error handler global de server.js
// lo reconoce y responde con `status`/`body` tal cual — cualquier otro error
// (uno no esperado) sigue cayendo en la respuesta 500 genérica y saneada.
export class HttpError extends Error {
  constructor(status, body) {
    const message = typeof body === 'string' ? body : (body.error || (body.errors || []).join(' '));
    super(message);
    this.status = status;
    this.body = typeof body === 'string' ? { error: body } : body;
  }
}
