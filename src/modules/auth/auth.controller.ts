import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/db.js';
import { comparePassword } from '../../utils/hash.js';
import { generateToken } from '../../utils/jwt.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logAudit } from '../../utils/audit.js';

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { employeeId, password } = req.body;

    if (!employeeId || !password) {
      throw new AppError('ID and password are required.', 400, 'MISSING_FIELDS');
    }

    const trimmedInput = employeeId.trim();

    const user = await db.user.findFirst({
      where: {
        OR: [
          { employeeId: trimmedInput },
          { email: trimmedInput },
          { employeeId: trimmedInput.toLowerCase() },
          { employeeId: trimmedInput.toUpperCase() },
          { email: trimmedInput.toLowerCase() },
        ],
      },
      include: { department: true },
    });

    if (!user) {
      throw new AppError('Invalid ID or password.', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Your employee account is deactivated. Contact Administrator.', 403, 'ACCOUNT_DISABLED');
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid ID or password.', 401, 'INVALID_CREDENTIALS');
    }

    // Start activity session
    await db.activitySession.create({
      data: {
        userId: user.id,
        loginAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });

    const token = generateToken({
      userId: user.id,
      employeeId: user.employeeId,
      role: user.role as any,
      name: user.name,
      email: user.email,
    });

    await logAudit(user.id, 'USER_LOGIN', 'User', user.id, { role: user.role }, req.ip);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          employeeId: user.employeeId,
          name: user.name,
          email: user.email,
          role: user.role,
          designation: user.designation,
          department: user.department ? user.department.name : null,
          joiningDate: user.joiningDate,
        },
      },
      message: 'Logged in successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Unauthenticated', 401, 'UNAUTHORIZED');
    }

    const user = await db.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        designation: true,
        joiningDate: true,
        isActive: true,
        department: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) {
      throw new AppError('User not found.', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user) {
      await logAudit(req.user.userId, 'USER_LOGOUT', 'User', req.user.userId, null, req.ip);
    }
    res.clearCookie('token');
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (err) {
    next(err);
  }
};
