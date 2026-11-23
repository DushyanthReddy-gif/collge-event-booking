import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ApiError, toApiError } from '@/lib/db/errors';

type Params = Record<string, string>;
type Handler = (req: NextRequest, params: Params) => Promise<unknown>;

/** Wraps a route handler: awaits params, converts thrown errors to JSON, serialises results. */
export function route(fn: Handler) {
  return async (req: NextRequest, ctx: { params: Promise<Params> }): Promise<Response> => {
    try {
      const params = (await ctx?.params) ?? {};
      const result = await fn(req, params);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
        return NextResponse.json({ error: 'Validation failed', details }, { status: 400 });
      }
      const apiErr = toApiError(err);
      return NextResponse.json({ error: apiErr.message, details: apiErr.details }, { status: apiErr.status });
    }
  };
}

export function created(data: unknown) {
  return NextResponse.json(data, { status: 201 });
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON');
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export function parseId(value: string | undefined, label = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `Invalid ${label}`);
  return n;
}
