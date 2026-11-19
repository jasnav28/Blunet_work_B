import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting BluNet Workplace production database seeding...');

  // 1. Create Departments
  const deptEng = await prisma.department.upsert({
    where: { code: 'ENG' },
    update: {},
    create: { name: 'Engineering & Development', code: 'ENG' },
  });

  const deptMkt = await prisma.department.upsert({
    where: { code: 'MKT' },
    update: {},
    create: { name: 'Marketing & Sales', code: 'MKT' },
  });

  const deptExec = await prisma.department.upsert({
    where: { code: 'EXEC' },
    update: {},
    create: { name: 'Executive Leadership', code: 'EXEC' },
  });

  const deptOps = await prisma.department.upsert({
    where: { code: 'OPS' },
    update: {},
    create: { name: 'Operations & HR', code: 'OPS' },
  });

  // Hash exact production passwords for specified accounts
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const empPasswordHash = await bcrypt.hash('Punith#214', 10);
  const ma1011PasswordHash = await bcrypt.hash('Password#1234', 10);
  const an1012PasswordHash = await bcrypt.hash('Password#4321', 10);
  const founderPasswordHash = await bcrypt.hash('Founder#1234', 10);
  const beastPasswordHash = await bcrypt.hash('Beast@123', 10);
  const mounendraPasswordHash = await bcrypt.hash('Mounendra@123', 10);

  // Clear previous dummy users and transactional data cleanly
  await prisma.taskComment.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.leadResponse.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.leadCampaign.deleteMany({});
  await prisma.activitySession.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.fileUpload.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Create Production Core Accounts
  const adminUser = await prisma.user.create({
    data: {
      employeeId: 'admin',
      name: 'System Administrator',
      email: 'admin@blunet.com',
      phone: '+91 98765 43210',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      designation: 'System Administrator',
      departmentId: deptOps.id,
      joiningDate: new Date('2024-01-01'),
    },
  });

  const empUser = await prisma.user.create({
    data: {
      employeeId: 'EMP1022',
      name: 'Punith',
      email: 'punith@blunet.com',
      phone: '+91 98765 43212',
      passwordHash: empPasswordHash,
      role: 'EMPLOYEE',
      designation: 'Software Engineer',
      departmentId: deptEng.id,
      joiningDate: new Date('2024-03-01'),
    },
  });

  const ma1011User = await prisma.user.create({
    data: {
      employeeId: 'MA1011',
      name: 'Marketing Head 1',
      email: 'ma1011@blunet.com',
      phone: '+91 98765 43211',
      passwordHash: ma1011PasswordHash,
      role: 'MARKETING_HEAD',
      designation: 'Marketing Head',
      departmentId: deptMkt.id,
      joiningDate: new Date('2024-02-15'),
    },
  });

  const an1012User = await prisma.user.create({
    data: {
      employeeId: 'AN1012',
      name: 'Anvi Marketing Head',
      email: 'an1012@anvi.com',
      phone: '+91 98765 43214',
      passwordHash: an1012PasswordHash,
      role: 'MARKETING_HEAD',
      designation: 'Marketing Lead (Anvi)',
      departmentId: deptMkt.id,
      joiningDate: new Date('2024-02-20'),
    },
  });

  const founderUser = await prisma.user.create({
    data: {
      employeeId: 'FOUNDER01',
      name: 'Vikramaditya Roy',
      email: 'founder@blunet.com',
      phone: '+91 98765 43213',
      passwordHash: founderPasswordHash,
      role: 'FOUNDER',
      designation: 'Founder & CEO',
      departmentId: deptExec.id,
      joiningDate: new Date('2023-11-01'),
    },
  });

  const beastUser = await prisma.user.create({
    data: {
      employeeId: 'Beast@123',
      name: 'Beast Marketing',
      email: 'beast@blunet.com',
      phone: '+91 98765 43215',
      passwordHash: beastPasswordHash,
      role: 'MARKETING_HEAD',
      designation: 'Marketing Head',
      departmentId: deptMkt.id,
      joiningDate: new Date('2024-03-01'),
    },
  });

  const mounendraUser = await prisma.user.create({
    data: {
      employeeId: 'BLU-EMP-003',
      name: 'MOUNENDRA GOWA M',
      email: 'Mounendra@123',
      phone: '+91 98765 43216',
      passwordHash: mounendraPasswordHash,
      role: 'MARKETING_HEAD',
      designation: 'Marketing Executive',
      departmentId: deptMkt.id,
      joiningDate: new Date('2026-11-23'),
    },
  });

  console.log('✅ Created Real Accounts: admin, EMP1022, MA1011, AN1012, FOUNDER01, Beast@123, BLU-EMP-003 (MOUNENDRA)');

  // 3. Resource Categories
  const categories = [
    { name: 'Company', description: 'General company policies and handbooks' },
    { name: 'Marketing', description: 'Brand assets, pitch decks, and campaigns' },
    { name: 'Development', description: 'Architecture guidelines and API docs' },
    { name: 'Policies', description: 'HR and Compliance guidelines' },
  ];

  for (const cat of categories) {
    await prisma.resourceCategory.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  // 4. Marketing Target for Current Month
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  await prisma.marketingTarget.upsert({
    where: { month_year: { month: currentMonth, year: currentYear } },
    update: {},
    create: {
      month: currentMonth,
      year: currentYear,
      targetLeads: 500,
      targetCalls: 200,
      targetDeals: 25,
      targetRevenue: 1000000,
    },
  });

  // 5. Default Campaign & Sequential Leads
  const campaign = await prisma.leadCampaign.create({
    data: {
      name: 'Enterprise IT Client Acquisition',
      description: 'Outreach to enterprise IT leads in Bengaluru, Mumbai, & Hyderabad',
      month: currentMonth,
      year: currentYear,
      status: 'ACTIVE',
    },
  });

  const initialLeads = [
    {
      sequenceNumber: 1,
      businessName: 'Apex Tech Solutions',
      phone: '+91 80 4123 9871',
      email: 'contact@apextech.in',
      website: 'https://apextech.in',
      city: 'Bengaluru',
      state: 'Karnataka',
      status: 'AVAILABLE',
    },
    {
      sequenceNumber: 2,
      businessName: 'CloudMatrix Global',
      phone: '+91 22 6789 1234',
      email: 'info@cloudmatrix.com',
      website: 'https://cloudmatrix.com',
      city: 'Mumbai',
      state: 'Maharashtra',
      status: 'LOCKED',
    },
    {
      sequenceNumber: 3,
      businessName: 'NexGen FinTech Solutions',
      phone: '+91 80 2345 6789',
      email: 'sales@nexgenfintech.io',
      website: 'https://nexgenfintech.io',
      city: 'Bengaluru',
      state: 'Karnataka',
      status: 'LOCKED',
    },
  ];

  for (const leadData of initialLeads) {
    await prisma.lead.create({
      data: {
        ...leadData,
        campaignId: campaign.id,
      },
    });
  }

  // 6. Real Active Tasks
  await prisma.task.create({
    data: {
      title: 'Setup BluNet Workplace Core Architecture',
      description: 'Deploy Vite frontend shell, Express REST API, and SQLite database schema.',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      assignedById: adminUser.id,
      assignedToId: empUser.id,
    },
  });

  await prisma.task.create({
    data: {
      title: 'Lead Campaign File Import Review',
      description: 'Upload and verify PDF/CSV marketing leads into BluNet Workplace queue.',
      priority: 'URGENT',
      status: 'TODO',
      dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      assignedById: ma1011User.id,
      assignedToId: empUser.id,
    },
  });

  await prisma.task.create({
    data: {
      title: 'Enterprise Marketing & Client Acquisition Strategy',
      description: 'Review lead conversion metrics, optimize sequential outreach queue, and track monthly sales targets.',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      assignedById: adminUser.id,
      assignedToId: beastUser.id,
    },
  });

  console.log('✅ BluNet Workplace Seeding Completed Successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
