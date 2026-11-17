export type BookingStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
export type TripStatus = "NOTSTARTED" | "INPROGRESS" | "ARRIVED" | "COMPLETED";
export type DriverStatus = "ACTIVE" | "OFF" | "ONTRIP" | "ONLEAVE";
export type VehicleStatus = "AVAILABLE" | "BOOKED" | "MAINTENANCE";
export type AuditAction = "CREATE" | "UPDATE" | "DELETE";
export type Period = "day" | "month" | "year";

export interface Me {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  role: { id: string; name: "SUPER_ADMIN" | "ADMIN" | "CUSTOMER" | "DRIVER"; permissions: string[] } | null;
}

export type Alert =
  | { type: "maintenance"; severity: "warning"; entityId: string; vehicleName: string; maintenanceType: string; daysUntil: number }
  | { type: "complaint"; severity: "danger"; entityId: string; driverName: string; rating: number; bookingId: string };

export interface Overview {
  today: string;
  kpis: {
    todayBookings: number;
    yesterdayBookings: number;
    monthRevenue: number;
    lastMonthRevenue: number;
    totalVehicles: number;
    availableVehicles: number;
    bookedVehicles: number;
    maintenanceVehicles: number;
    occupancyRate: number;
    liveTrips: number;
    pendingBookings: number;
  };
  weeklyRevenue: { date: string; revenue: number }[];
  alerts: Alert[];
}

export type PaymentMethod = "CASH" | "PAYMOB" | "FAWRY" | "WALLET";
export interface PaymentRecord {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  createdAt: string;
}

export interface DriverSummary {
  id: string;
  name: string;
  status: DriverStatus;
  statusLocked?: boolean;
  rating: number;
  reviewCount: number;
  complaints: number;
  monthRevenue: number;
  monthTrips: number;
  totalTrips: number;
}

export interface FleetVehicle {
  id: string;
  make: string;
  model: string;
  category: string;
  status: VehicleStatus;
  plateNumber: string;
  assignedDrivers: { id: string; name: string; status: DriverStatus; isPrimary: boolean }[];
  todayAvailability: "AVAILABLE" | "BOOKED" | "BLOCKED";
}

export interface BookingListItem {
  id: string;
  bookingDate: string;
  startTime: string;
  status: BookingStatus;
  totalPrice: number;
  createdAt: string;
  vehicle: { id: string; make: string; model: string; category: string };
  customer: { id: string; name: string; phoneNumber: string | null };
  driver: { id: string; fullName: string };
}

export interface DayDetails {
  date: string;
  stats: { total: number; pending: number; expectedRevenue: number; vehiclesUsed: number; totalVehicles: number };
  bookings: {
    id: string;
    ref: string;
    status: BookingStatus;
    tripStatus: TripStatus;
    startTime: string;
    endTime: string;
    startPoint: string;
    endPoint: string;
    eventType: string;
    packageId: string | null;
    totalPrice: number;
    packageDiscount: number;
    referralDiscount: number;
    paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    depositRequired: number;
    paid: number;
    payments: PaymentRecord[];
    customer: { id: string; name: string; phoneNumber: string | null };
    vehicle: { id: string; name: string; plateNumber: string };
    driver: { id: string; fullName: string };
  }[];
  drivers: { id: string; name: string; status: DriverStatus; trips: string[] }[];
}

export interface LiveTrip {
  id: string;
  ref: string;
  bookingDate: string;
  tripStatus: TripStatus;
  startPoint: string;
  endPoint: string;
  customer: { id: string; name: string; phoneNumber: string | null };
  vehicle: { id: string; name: string; plateNumber: string };
  driver: { id: string; name: string; phone: string | null };
  startedAt: string;
  startedOnRecord: boolean;
  elapsedMinutes: number;
  remainingMinutes: number;
  delayMinutes: number;
  isDelayed: boolean;
  progress: number;
}

export interface DriverAnalytics {
  driver: { id: string; name: string; status: DriverStatus; commissionRate: number };
  period: Period;
  periodStats: { trips: number; driverIncome: number; companyShare: number; driverNet: number };
  lifetime: { trips: number; driverIncome: number; companyShare: number; averageTripValue: number };
  quality: { rating: number | null; reviewCount: number; complaints: number; punctualityRate: number | null };
  chart: { key: string; income: number; share: number }[];
  recentTrips: { id: string; ref: string; bookingDate: string; customer: { id: string; name: string }; value: number; share: number; status: BookingStatus }[];
}

export interface CustomerAnalytics {
  customer: { id: string; name: string; phoneNumber: string | null; email: string | null; memberSince: string; rating: number | null; isVip: boolean };
  period: Period;
  periodStats: { bookings: number; spend: number };
  lifetime: { spend: number; bookings: number; averageBookingValue: number; cancelled: number; walletBalance: number };
  referrals: { invited: number; converted: number };
  chart: { key: string; spend: number }[];
  recentBookings: { id: string; ref: string; bookingDate: string; vehicle: string; value: number; status: BookingStatus }[];
}

export interface CustomerHit {
  id: string;
  name: string;
  phoneNumber: string | null;
  bookingsCount: number;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityLabel: string;
  details: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  category: string;
  status: VehicleStatus;
  plateNumber: string;
  basePrice: number;
  pricePerKm: number;
  pricePerHour: number;
  capacity: number;
  year: number;
}

export type CategoryRate = { basePrice: number; pricePerKm: number; pricePerHour: number };

export interface BusinessSettings {
  depositRate: number;
  bookingBufferMinutes: number;
  tripEarlyStartMinutes: number;
  defaultCommissionRate: number;
  referralRewardAmount: number;
  referredDiscountAmount: number;
  peakSurgeMultiplier: number;
  vipSpendThreshold: number;
  delayAlertMinutes: number;
  punctualityGraceMinutes: number;
  complaintMaxRating: number;
  maintenanceAlertDays: number;
  categoryRates: Record<string, CategoryRate>;
}

export interface SettingsResponse extends BusinessSettings {
  defaults: BusinessSettings;
  updatedAt: string;
}

export interface AdminPackage {
  id: string;
  packageName: string;
  packageType: "MULTI_CAR" | "MULTI_EVENT";
  status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  discountPercentage: number;
  totalPrice: number;
  createdAt: string;
  customer: { id: string; name: string; phoneNumber: string | null };
  bookingsCount: number;
  unpaidBookings: number;
  discountGiven: number;
}
