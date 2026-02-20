import { Hono } from 'hono'
import type { Env } from '../index'
import type { User } from '../types'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import * as db from '../db'
import { labelsPage } from '../templates/labels'

export const labelsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

labelsRoutes.use('*', requireAuth)

labelsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const labels = await db.getAllLabels(c.env.DB, user.id)
  return c.html(labelsPage(user.email, labels))
})

labelsRoutes.post('/create', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const name = String(body.name ?? '').trim()
  const description = String(body.description ?? '').trim()
  if (!name) return c.text('Name required', 400)
  await db.createLabel(c.env.DB, user.id, name, description)
  return c.redirect('/labels', 302)
})

labelsRoutes.post('/:id/delete', async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  await db.deleteLabel(c.env.DB, user.id, id)
  return c.redirect('/labels', 302)
})
