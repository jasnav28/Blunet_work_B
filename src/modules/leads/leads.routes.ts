import { Router } from 'express';
import multer from 'multer';
import {
  getActiveLead,
  getLeadQueue,
  getCompletedLeads,
  getLeadsByOutcome,
  markCallMade,
  markCallMadeAndNext,
  callAgainLead,
  submitResponse,
  previewImport,
  confirmImport,
} from './leads.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const router = Router();

router.use(authenticate);

router.get('/active', requireRole(['MARKETING_HEAD', 'ADMIN']), getActiveLead);
router.get('/queue', requireRole(['MARKETING_HEAD', 'ADMIN']), getLeadQueue);
router.get('/completed', requireRole(['MARKETING_HEAD', 'ADMIN']), getCompletedLeads);
router.get('/outcome/:outcome', requireRole(['MARKETING_HEAD', 'ADMIN']), getLeadsByOutcome);

router.post('/:id/call-made', requireRole(['MARKETING_HEAD', 'ADMIN']), markCallMade);
router.post('/:id/mark-later', requireRole(['MARKETING_HEAD', 'ADMIN']), markCallMadeAndNext);
router.post('/:id/call-again', requireRole(['MARKETING_HEAD', 'ADMIN']), callAgainLead);
router.post('/:id/response', requireRole(['MARKETING_HEAD', 'ADMIN']), submitResponse);

router.post('/import/preview', requireRole(['ADMIN']), upload.single('file'), previewImport);
router.post('/import/confirm', requireRole(['ADMIN']), confirmImport);

export default router;
