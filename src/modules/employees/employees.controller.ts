import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/db.js';
import { hashPassword } from '../../utils/hash.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logAudit } from '../../utils/audit.js';

export const getEmployees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, departmentId, role, isActive } = req.query;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { employeeId: { contains: String(search) } },
        { email: { contains: String(search) } },
      ];
    }
    if (departmentId) where.departmentId = String(departmentId);
    if (role) where.role = String(role);
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const employees = await db.user.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        designation: true,
        isActive: true,
        joiningDate: true,
        department: { select: { id: true, name: true, code: true } },
        assignedTasks: {
          select: { id: true, status: true },
        },
        activitySessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { lastHeartbeatAt: true, activeSeconds: true },
        },
      },
      orderBy: { employeeId: 'asc' },
    });

    const employeesWithStats = employees.map((emp) => {
      const total = emp.assignedTasks.length;
      const completed = emp.assignedTasks.filter((t) => t.status === 'COMPLETED').length;
      const inProgress = emp.assignedTasks.filter((t) => t.status === 'IN_PROGRESS').length;
      const progressRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      const { assignedTasks, ...rest } = emp;

      return {
        ...rest,
        taskStats: {
          total,
          completed,
          inProgress,
          progressRate,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: employeesWithStats,
    });
  } catch (err) {
    next(err);
  }
};

export const createEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, phone, role, designation, departmentId, temporaryPassword, joiningDate } = req.body;

    if (!name || !email || !role || !designation || !temporaryPassword) {
      throw new AppError('Name, email, role, designation, and temporary password are required.', 400, 'MISSING_FIELDS');
    }

    const existingEmail = await db.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw new AppError('An employee with this email already exists.', 400, 'DUPLICATE_EMAIL');
    }

    const allUsers = await db.user.findMany({ select: { employeeId: true } });
    let highestNum = 0;
    for (const u of allUsers) {
      const match = u.employeeId.match(/^BLU-EMP-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > highestNum) highestNum = num;
      }
    }
    const nextNum = highestNum + 1;
    const employeeId = `BLU-EMP-${String(nextNum).padStart(3, '0')}`;

    const passwordHash = await hashPassword(temporaryPassword);

    const employee = await db.user.create({
      data: {
        employeeId,
        name,
        email,
        phone: phone || null,
        role,
        designation,
        departmentId: departmentId || null,
        joiningDate: joiningDate ? new Date(joiningDate) : undefined,
        passwordHash,
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        role: true,
        designation: true,
        departmentId: true,
        joiningDate: true,
        isActive: true,
      },
    });

    await logAudit(req.user?.userId, 'EMPLOYEE_CREATED', 'User', employee.id, { employeeId, role }, req.ip);

    res.status(201).json({
      success: true,
      data: employee,
      message: `Employee ${employee.name} (${employee.employeeId}) created successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

export const getEmployeeById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const employee = await db.user.findUnique({
      where: { id },
      include: {
        department: true,
        assignedTasks: {
          select: { id: true, title: true, priority: true, status: true, dueDate: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        activitySessions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!employee) {
      throw new AppError('Employee not found.', 404, 'NOT_FOUND');
    }

    const { passwordHash, ...sanitized } = employee;

    res.status(200).json({
      success: true,
      data: sanitized,
    });
  } catch (err) {
    next(err);
  }
};

export const updateEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, phone, role, designation, departmentId, isActive, newPassword, joiningDate } = req.body;

    const dataToUpdate: any = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (phone !== undefined) dataToUpdate.phone = phone;
    if (role !== undefined) dataToUpdate.role = role;
    if (designation !== undefined) dataToUpdate.designation = designation;
    if (departmentId !== undefined) dataToUpdate.departmentId = departmentId;
    if (isActive !== undefined) dataToUpdate.isActive = isActive;
    if (joiningDate !== undefined) dataToUpdate.joiningDate = new Date(joiningDate);

    if (newPassword) {
      dataToUpdate.passwordHash = await hashPassword(newPassword);
    }

    const updated = await db.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        role: true,
        designation: true,
        isActive: true,
      },
    });

    await logAudit(req.user?.userId, 'EMPLOYEE_UPDATED', 'User', id, dataToUpdate, req.ip);

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Employee updated successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export const deleteEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const requestingUserId = req.user?.userId;

    if (id === requestingUserId) {
      throw new AppError('You cannot delete your own active admin account.', 400, 'CANNOT_DELETE_SELF');
    }

    const employee = await db.user.findUnique({ where: { id } });
    if (!employee) {
      throw new AppError('Employee not found.', 404, 'NOT_FOUND');
    }

    // Safely delete associated records or delete user in transaction
    await db.$transaction([
      db.taskComment.deleteMany({ where: { authorId: id } }),
      db.leadResponse.deleteMany({ where: { userId: id } }),
      db.activitySession.deleteMany({ where: { userId: id } }),
      db.notification.deleteMany({ where: { userId: id } }),
      db.user.delete({ where: { id } }),
    ]);

    await logAudit(requestingUserId, 'EMPLOYEE_DELETED', 'User', id, { name: employee.name, employeeId: employee.employeeId }, req.ip);

    res.status(200).json({
      success: true,
      message: `Employee ${employee.name} (${employee.employeeId}) deleted successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

export const getDepartments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const departments = await db.department.findMany({ orderBy: { name: 'asc' } });
    res.status(200).json({ success: true, data: departments });
  } catch (err) {
    next(err);
  }
};
