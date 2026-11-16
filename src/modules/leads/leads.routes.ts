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

router.get('/active', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), getActiveLead);
router.get('/queue', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), getLeadQueue);
router.get('/completed', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), getCompletedLeads);
router.get('/outcome/:outcome', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), getLeadsByOutcome);

router.post('/:id/call-made', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), markCallMade);
router.post('/:id/mark-later', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), markCallMadeAndNext);
router.post('/:id/call-again', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), callAgainLead);
router.post('/:id/response', requireRole(['MARKETING_HEAD', 'ADMIN', 'EMPLOYEE']), submitResponse);

router.post('/import/preview', requireRole(['ADMIN']), upload.single('file'), previewImport);
router.post('/import/confirm', requireRole(['ADMIN']), confirmImport);

export default router;
