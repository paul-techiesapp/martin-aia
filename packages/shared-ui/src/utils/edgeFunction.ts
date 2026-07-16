/**
 * Reading the real error out of a failed `supabase.functions.invoke()`.
 *
 * supabase-js resolves invoke() to `{ data: null, error }` for ANY non-2xx
 * response, and that error's `message` is the constant "Edge Function returned
 * a non-2xx status code". The JSON body our edge functions return — the
 * `{ error, field }` shape they all use to explain what went wrong — is left
 * unread on `error.context`, which is the raw `Response`. Consuming it here is
 * the only way those messages ever reach the user.
 */
export interface EdgeFunctionFailure {
  message: string;
  field?: string;
  status?: number;
}

function isResponseLike(value: unknown): value is Response {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Response).json === 'function' &&
    typeof (value as Response).status === 'number'
  );
}

export async function readEdgeFunctionError(
  error: unknown,
  fallback: string,
): Promise<EdgeFunctionFailure> {
  const context = (error as { context?: unknown } | null)?.context;

  if (isResponseLike(context)) {
    try {
      const body = await context.json();
      const message =
        typeof body?.error === 'string' && body.error.trim()
          ? body.error
          : fallback;
      const field = typeof body?.field === 'string' ? body.field : undefined;
      return { message, field, status: context.status };
    } catch {
      // Non-JSON body (a crashed function, a gateway page): fall through to the
      // status line, which is still more useful than the generic message.
      return { message: `${fallback} (HTTP ${context.status})`, status: context.status };
    }
  }

  // FunctionsFetchError (network/CORS) has no Response — its message is real.
  const message = (error as { message?: string } | null)?.message;
  return { message: message || fallback };
}
