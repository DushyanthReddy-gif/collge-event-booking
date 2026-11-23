import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time' });
const id = z.coerce.number().int().positive();

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Name is too short').max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72)
    .regex(/[A-Za-z]/, 'Password needs a letter')
    .regex(/[0-9]/, 'Password needs a number'),
  department: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

const eventFields = {
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(5000).default(''),
  categoryId: id,
  venueId: id,
  startTime: isoDate,
  endTime: isoDate,
  capacity: z.coerce.number().int().positive().max(100000),
};

export const eventCreateSchema = z
  .object({ ...eventFields, status: z.enum(['draft', 'published']).default('draft') })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const eventUpdateSchema = z
  .object(eventFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine((v) => !(v.startTime && v.endTime) || new Date(v.endTime) > new Date(v.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const eventStatusSchema = z.object({ status: z.enum(['published', 'cancelled']) });

export const eventFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: id.optional(),
  venueId: id.optional(),
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  scope: z.enum(['public', 'manage']).default('public'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchSchema = z.object({
  q: z.string().trim().max(200).default(''),
  mode: z.enum(['keyword', 'semantic']).default('keyword'),
  categoryId: id.optional(),
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).default(''),
});

export const attendanceSchema = z.object({
  records: z
    .array(z.object({ bookingId: id, attended: z.boolean() }))
    .min(1, 'Provide at least one record')
    .max(1000),
});

export const venueSchema = z.object({
  name: z.string().trim().min(2).max(100),
  location: z.string().trim().max(150).default(''),
  capacity: z.coerce.number().int().positive().max(100000),
  isActive: z.boolean().default(true),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).default(''),
  parentCategoryId: id.nullable().optional(),
});

export const userPatchSchema = z
  .object({ isActive: z.boolean(), role: z.enum(['student', 'organizer', 'admin']) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const interestsSchema = z.object({ categoryIds: z.array(id).max(30) });

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type EventFilters = z.infer<typeof eventFilterSchema>;
