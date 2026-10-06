import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logAudit } from '../../utils/audit.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  TODO: ['IN_PROGRESS', 'CANCELLED', 'SUBMITTED'],
  IN_PROGRESS: ['COMPLETED', 'TODO', 'CANCELLED', 'SUBMITTED'],
  SUBMITTED: ['COMPLETED', 'IN_PROGRESS', 'TODO'],
  COMPLETED: ['IN_PROGRESS', 'SUBMITTED'],
  CANCELLED: ['TODO'],
  OVERDUE: ['IN_PROGRESS', 'COMPLETED', 'SUBMITTED'],
};

export const getMyTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { status, priority } = req.query;

    const where: any = { assignedToId: userId };
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);

    const tasks = await db.task.findMany({
      where,
      include: {
        assignedBy: { select: { id: true, name: true, employeeId: true, role: true } },
        comments: {
          include: { author: { select: { id: true, name: true, employeeId: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { assignedToId, status, priority, search } = req.query;

    const where: any = {};
    if (assignedToId) where.assignedToId = String(assignedToId);
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (search) {
      where.OR = [
        { title: { contains: String(search) } },
        { description: { contains: String(search) } },
      ];
    }

    const tasks = await db.task.findMany({
      where,
      include: {
        assignedBy: { select: { id: true, name: true, employeeId: true, role: true } },
        assignedTo: { select: { id: true, name: true, employeeId: true, designation: true } },
        comments: {
          include: { author: { select: { id: true, name: true, employeeId: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (err) {
    next(err);
  }
};

export const createTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, description, priority, assignedToId, dueDate } = req.body;
    const assignedById = req.user?.userId;

    if (!title || !description || !assignedToId || !assignedById) {
      throw new AppError('Title, description, and assigned employee are required.', 400, 'MISSING_FIELDS');
    }

    const targetUser = await db.user.findUnique({ where: { id: String(assignedToId) } });
    if (!targetUser) {
      throw new AppError('Assigned employee does not exist.', 404, 'USER_NOT_FOUND');
    }

    const task = await db.task.create({
      data: {
        title,
        description,
        priority: priority || 'MEDIUM',
        status: 'TODO',
        assignedById,
        assignedToId: String(assignedToId),
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        assignedBy: { select: { id: true, name: true, employeeId: true } },
        assignedTo: { select: { id: true, name: true, employeeId: true } },
      },
    });

    await db.notification.create({
      data: {
        userId: String(assignedToId),
        title: 'New Task Assigned',
        message: `Task "${title}" assigned by ${req.user?.name}.`,
        link: '/tasks',
      },
    });

    await logAudit(assignedById, 'TASK_CREATED', 'Task', task.id, { title, assignedToId }, req.ip);

    res.status(201).json({
      success: true,
      data: task,
      message: 'Task assigned successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export const updateTaskStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status, submissionDetails, submissionLinks } = req.body;
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!status) {
      throw new AppError('New status is required.', 400, 'MISSING_STATUS');
    }

    const task = await db.task.findUnique({ where: { id } });
    if (!task) {
      throw new AppError('Task not found.', 404, 'NOT_FOUND');
    }

    if (role === 'EMPLOYEE' && task.assignedToId !== userId) {
      throw new AppError('You can only update your own assigned tasks.', 403, 'FORBIDDEN');
    }

    const allowed = VALID_TRANSITIONS[task.status] || [];
    if (!allowed.includes(status) && role === 'EMPLOYEE') {
      throw new AppError(`Invalid status transition from ${task.status} to ${status}.`, 400, 'INVALID_TRANSITION');
    }

    const updated = await db.task.update({
      where: { id },
      data: { status },
      include: {
        assignedBy: { select: { id: true, name: true, employeeId: true } },
        assignedTo: { select: { id: true, name: true, employeeId: true } },
      },
    });

    if (submissionDetails || submissionLinks) {
      let contentStr = `📌 WORK SUBMISSION FOR REVIEW:`;
      if (submissionDetails) contentStr += `\n\nDetails:\n${submissionDetails}`;
      if (submissionLinks) contentStr += `\n\nRelated Links:\n${submissionLinks}`;

      await db.taskComment.create({
        data: {
          taskId: id,
          authorId: String(userId),
          content: contentStr,
        },
      });

      if (task.assignedById) {
        await db.notification.create({
          data: {
            userId: task.assignedById,
            title: 'Task Submitted for Review',
            message: `${req.user?.name || 'Employee'} submitted task "${task.title}" for review.`,
            link: '/tasks',
          },
        });
      }
    } else if (status === 'COMPLETED' && task.assignedToId) {
      await db.notification.create({
        data: {
          userId: task.assignedToId,
          title: 'Task Approved & Completed',
          message: `Your submitted task "${task.title}" has been reviewed and marked as COMPLETED by ${req.user?.name}.`,
          link: '/tasks',
        },
      });
    }

    await logAudit(userId, 'TASK_STATUS_UPDATED', 'Task', id, { from: task.status, to: status }, req.ip);

    res.status(200).json({
      success: true,
      data: updated,
      message: `Task status updated to ${status}.`,
    });
  } catch (err) {
    next(err);
  }
};

export const addTaskComment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { content } = req.body;
    const authorId = req.user?.userId;

    if (!content || !authorId) {
      throw new AppError('Comment content is required.', 400, 'MISSING_CONTENT');
    }

    const task = await db.task.findUnique({ where: { id } });
    if (!task) {
      throw new AppError('Task not found.', 404, 'NOT_FOUND');
    }

    const comment = await db.taskComment.create({
      data: {
        taskId: id,
        authorId,
        content,
      },
      include: {
        author: { select: { id: true, name: true, employeeId: true } },
      },
    });

    res.status(201).json({
      success: true,
      data: comment,
    });
  } catch (err) {
    next(err);
  }
};
