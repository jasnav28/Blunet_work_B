import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logAudit } from '../../utils/audit.js';
import { parseLeadFile } from './leadParser.js';

export const VALID_OUTCOMES = [
  'INTERESTED',
  'NOT_INTERESTED',
  'FOLLOW_UP_REQUIRED',
  'CALL_BACK_LATER',
  'NO_ANSWER',
  'WRONG_NUMBER',
  'CLOSED',
];

export const getActiveLead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { campaignId, leadId } = req.query;

    const campaignWhere = campaignId
      ? { id: String(campaignId) }
      : { status: 'ACTIVE' };

    const campaign = await db.leadCampaign.findFirst({
      where: campaignWhere,
      orderBy: { createdAt: 'desc' },
    });

    if (!campaign) {
      res.status(200).json({
        success: true,
        data: { activeLead: null, pendingLeads: [], pendingCount: 0, totalLeads: 0, completedLeads: 0, campaign: null },
      });
      return;
    }

    let activeLead = null;

    // 1. If explicit leadId requested (e.g. from client session storage or call-again selection)
    if (leadId) {
      activeLead = await db.lead.findFirst({
        where: {
          id: String(leadId),
          campaignId: campaign.id,
        },
        include: {
          responses: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
      });
    }

    // 2. If no valid requested leadId, find first AVAILABLE lead (current sequential dialing position)
    if (!activeLead) {
      activeLead = await db.lead.findFirst({
        where: {
          campaignId: campaign.id,
          status: 'AVAILABLE',
        },
        orderBy: { sequenceNumber: 'asc' },
        include: {
          responses: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
    }

    // 3. If no AVAILABLE lead, pick first RESPONSE_PENDING lead awaiting notes
    if (!activeLead) {
      activeLead = await db.lead.findFirst({
        where: {
          campaignId: campaign.id,
          status: 'RESPONSE_PENDING',
        },
        orderBy: { sequenceNumber: 'asc' },
        include: {
          responses: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
    }

    // 4. Fetch list of all leads currently awaiting response notes (RESPONSE_PENDING)
    const pendingLeads = await db.lead.findMany({
      where: {
        campaignId: campaign.id,
        status: 'RESPONSE_PENDING',
      },
      orderBy: { sequenceNumber: 'asc' },
      select: {
        id: true,
        sequenceNumber: true,
        businessName: true,
        phone: true,
        status: true,
        updatedAt: true,
      },
    });

    const totalLeads = await db.lead.count({ where: { campaignId: campaign.id } });
    const completedLeads = await db.lead.count({
      where: {
        campaignId: campaign.id,
        status: 'COMPLETED',
      },
    });

    res.status(200).json({
      success: true,
      data: {
        campaign,
        activeLead,
        pendingLeads,
        pendingCount: pendingLeads.length,
        totalLeads,
        completedLeads,
        remainingLeads: totalLeads - completedLeads,
        progressPercentage: totalLeads > 0 ? Math.round((completedLeads / totalLeads) * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const markCallMade = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const userId = req.user?.userId;

    const lead = await db.lead.findUnique({ where: { id } });

    if (!lead) {
      throw new AppError('Lead not found.', 404, 'LEAD_NOT_FOUND');
    }

    if (lead.status === 'LOCKED') {
      throw new AppError('This lead is locked. Complete the previous lead first.', 403, 'LEAD_LOCKED');
    }

    // Transition state from AVAILABLE to RESPONSE_PENDING
    const updatedLead = await db.lead.update({
      where: { id: lead.id },
      data: { status: 'RESPONSE_PENDING' },
    });

    await logAudit(userId, 'LEAD_CALL_MADE', 'Lead', lead.id, null, req.ip);

    res.status(200).json({
      success: true,
      data: updatedLead,
      message: 'Call marked as made. Please record customer response.',
    });
  } catch (err) {
    next(err);
  }
};

export const markCallMadeAndNext = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const userId = req.user?.userId;

    const lead = await db.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new AppError('Lead not found.', 404, 'LEAD_NOT_FOUND');
    }

    // Set current lead as RESPONSE_PENDING so notes can be recorded later
    await db.lead.update({
      where: { id: lead.id },
      data: { status: 'RESPONSE_PENDING' },
    });

    // Unlock next sequential lead in campaign
    const nextLead = await db.lead.findFirst({
      where: {
        campaignId: lead.campaignId,
        sequenceNumber: lead.sequenceNumber + 1,
      },
      include: {
        responses: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (nextLead && nextLead.status === 'LOCKED') {
      await db.lead.update({
        where: { id: nextLead.id },
        data: { status: 'AVAILABLE' },
      });
      nextLead.status = 'AVAILABLE';
    }

    await logAudit(userId, 'LEAD_CALL_MADE_NEXT', 'Lead', lead.id, { nextLeadId: nextLead?.id }, req.ip);

    res.status(200).json({
      success: true,
      data: {
        pendingLeadId: lead.id,
        nextLead: nextLead || null,
      },
      message: 'Call logged! You can enter response notes later. Next lead unlocked.',
    });
  } catch (err) {
    next(err);
  }
};

export const callAgainLead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const userId = req.user?.userId;

    const lead = await db.lead.findUnique({
      where: { id },
      include: {
        responses: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });

    if (!lead) {
      throw new AppError('Lead not found.', 404, 'LEAD_NOT_FOUND');
    }

    // Reactivate lead to RESPONSE_PENDING so caller can record follow-up call response
    const updated = await db.lead.update({
      where: { id: lead.id },
      data: {
        status: 'RESPONSE_PENDING',
      },
      include: {
        responses: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });

    await logAudit(userId, 'LEAD_CALL_AGAIN', 'Lead', lead.id, { previousOutcome: lead.outcome }, req.ip);

    res.status(200).json({
      success: true,
      data: updated,
      message: `Lead #${lead.sequenceNumber} (${lead.businessName}) activated for follow-up call.`,
    });
  } catch (err) {
    next(err);
  }
};

export const submitResponse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { outcome, notes, followUpRequired, followUpDate, followUpNote, dealValue } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('Unauthenticated user.', 401, 'UNAUTHORIZED');
    }

    if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
      throw new AppError(`Invalid response outcome. Allowed: [${VALID_OUTCOMES.join(', ')}]`, 400, 'INVALID_OUTCOME');
    }

    if (!notes || !notes.trim()) {
      throw new AppError('Customer response notes are required.', 400, 'RESPONSE_REQUIRED');
    }

    const isFollowUpNeeded = outcome === 'FOLLOW_UP_REQUIRED' || Boolean(followUpRequired);
    if (isFollowUpNeeded && !followUpDate) {
      throw new AppError('Follow-up date is required when follow-up is indicated.', 400, 'FOLLOWUP_DATE_REQUIRED');
    }

    // Transaction execution for sequential unlock
    const result = await db.$transaction(async (tx) => {
      const currentLead = await tx.lead.findUnique({ where: { id } });

      if (!currentLead) {
        throw new AppError('Lead not found.', 404, 'LEAD_NOT_FOUND');
      }

      if (currentLead.status === 'LOCKED') {
        throw new AppError('Cannot save response for a locked lead. Complete the previous lead first.', 403, 'LEAD_LOCKED');
      }

      // Record Lead Interaction Response
      const response = await tx.leadResponse.create({
        data: {
          leadId: currentLead.id,
          userId,
          outcome,
          notes: notes.trim(),
          followUpRequired: isFollowUpNeeded,
          followUpDate: followUpDate ? new Date(followUpDate) : null,
          followUpNote: followUpNote ? followUpNote.trim() : null,
          dealValue: dealValue ? parseFloat(dealValue) : 0.0,
        },
      });

      // Mark current lead COMPLETED
      await tx.lead.update({
        where: { id: currentLead.id },
        data: {
          status: 'COMPLETED',
          outcome,
        },
      });

      // Unlock next sequential lead in campaign if it was locked
      const nextLead = await tx.lead.findFirst({
        where: {
          campaignId: currentLead.campaignId,
          sequenceNumber: currentLead.sequenceNumber + 1,
        },
      });

      let nextLeadAvailable = false;
      let nextLeadId: string | null = null;

      if (nextLead && nextLead.status === 'LOCKED') {
        await tx.lead.update({
          where: { id: nextLead.id },
          data: { status: 'AVAILABLE' },
        });
        nextLeadAvailable = true;
        nextLeadId = nextLead.id;
      } else if (nextLead) {
        nextLeadAvailable = nextLead.status === 'AVAILABLE' || nextLead.status === 'RESPONSE_PENDING';
        nextLeadId = nextLead.id;
      }

      return {
        response,
        completedLeadId: currentLead.id,
        nextLeadId,
        nextLeadAvailable,
      };
    });

    await logAudit(userId, 'LEAD_RESPONSE_SAVED', 'LeadResponse', result.response.id, { leadId: id, outcome }, req.ip);

    res.status(200).json({
      success: true,
      data: result,
      message: 'Customer response saved successfully. Next lead unlocked.',
    });
  } catch (err) {
    next(err);
  }
};

export const getCompletedLeads = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { campaignId, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(String(page), 10);
    const limitNum = parseInt(String(limit), 10);
    const skip = (pageNum - 1) * limitNum;

    const where: any = { status: 'COMPLETED' };
    if (campaignId) where.campaignId = String(campaignId);

    const [total, leads] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        orderBy: { sequenceNumber: 'desc' },
        skip,
        take: limitNum,
        include: {
          responses: {
            include: { user: { select: { id: true, name: true, employeeId: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        completedLeads: leads,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getLeadQueue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { campaignId, limit = 15 } = req.query;

    const campaign = campaignId
      ? await db.leadCampaign.findUnique({ where: { id: String(campaignId) } })
      : await db.leadCampaign.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });

    if (!campaign) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const allLeads = await db.lead.findMany({
      where: {
        campaignId: campaign.id,
      },
      orderBy: { sequenceNumber: 'asc' },
      take: parseInt(String(limit), 10),
      select: {
        id: true,
        sequenceNumber: true,
        businessName: true,
        phone: true,
        status: true,
        outcome: true,
      },
    });

    res.status(200).json({
      success: true,
      data: allLeads.map((l) => ({
        id: l.id,
        sequenceNumber: l.sequenceNumber,
        businessName: l.businessName,
        phone: l.phone,
        status: l.status,
        outcome: l.outcome,
        label: l.status === 'LOCKED'
          ? `🔒 Lead #${String(l.sequenceNumber).padStart(3, '0')} (Locked)`
          : l.status === 'RESPONSE_PENDING'
          ? `⏳ Lead #${String(l.sequenceNumber).padStart(3, '0')}: ${l.businessName} (Pending Notes)`
          : l.status === 'AVAILABLE'
          ? `📞 Lead #${String(l.sequenceNumber).padStart(3, '0')}: ${l.businessName} (Ready to Call)`
          : `✓ Lead #${String(l.sequenceNumber).padStart(3, '0')}: ${l.businessName} (${l.outcome || 'Completed'})`,
      })),
    });
  } catch (err) {
    next(err);
  }
};

export const getLeadsByOutcome = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const outcome = String(req.params.outcome).toUpperCase();
    const { campaignId } = req.query;

    const campaign = campaignId
      ? await db.leadCampaign.findUnique({ where: { id: String(campaignId) } })
      : await db.leadCampaign.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });

    const where: any = {
      outcome,
    };
    if (campaign) {
      where.campaignId = campaign.id;
    }

    const leads = await db.lead.findMany({
      where,
      orderBy: { sequenceNumber: 'asc' },
      include: {
        responses: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, name: true, employeeId: true } },
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      data: {
        outcome,
        total: leads.length,
        leads,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const previewImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const file = req.file;

    if (!file) {
      throw new AppError('Lead file (PDF, CSV, or XLSX) is required.', 400, 'MISSING_FILE');
    }

    const previewResult = await parseLeadFile(file.buffer, file.mimetype, file.originalname);

    res.status(200).json({
      success: true,
      data: previewResult,
    });
  } catch (err) {
    next(err);
  }
};

export const confirmImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { campaignName, leads } = req.body;
    const userId = req.user?.userId;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      throw new AppError('No valid leads provided for import.', 400, 'EMPTY_LEADS');
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const campaign = await db.leadCampaign.create({
      data: {
        name: campaignName || `Imported Campaign ${now.toISOString().split('T')[0]}`,
        month: currentMonth,
        year: currentYear,
        status: 'ACTIVE',
      },
    });

    const importedLeads = await db.$transaction(async (tx) => {
      let seq = 1;
      const createdLeads = [];

      for (const item of leads) {
        const status = seq === 1 ? 'AVAILABLE' : 'LOCKED';

        const lead = await tx.lead.create({
          data: {
            sequenceNumber: seq,
            campaignId: campaign.id,
            businessName: item.businessName,
            phone: item.phone,
            email: item.email || null,
            website: item.website || null,
            address: item.address || null,
            city: item.city || null,
            state: item.state || null,
            country: item.country || 'India',
            source: item.source || 'Admin Upload',
            status,
          },
        });
        createdLeads.push(lead);
        seq++;
      }
      return createdLeads;
    });

    await logAudit(userId, 'LEADS_IMPORTED', 'LeadCampaign', campaign.id, { count: importedLeads.length }, req.ip);

    res.status(201).json({
      success: true,
      data: {
        campaign,
        importedCount: importedLeads.length,
      },
      message: `Successfully imported ${importedLeads.length} leads into campaign "${campaign.name}".`,
    });
  } catch (err) {
    next(err);
  }
};
