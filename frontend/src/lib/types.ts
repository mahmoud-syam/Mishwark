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
  | { type: "complaint"; severity: "danger"; entityId: string; driverName: string; rating: number; bookingId: string }
  | { type: "no_driver"; severity: "warning"; entityId: string; vehicleName: string }
  | { type: "driver_unavailable"; severity: "danger"; entityId: string; driverName: string; driverStatus: DriverStatus; trips: number; firstDate: string };

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
    bookingDate: string;
    notes: string;
    createdAt: string;
    cancelledAt: string | null;
    depositOutcome: "REFUNDED" | "KEPT" | null;
    depositRefunded: number;
    serviceType?: "WEDDING" | "TRIP" | "VIP" | null;
    priceLines?: PriceLine[] | null;
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
  maxAdvanceBookingDays: number;
  weddingDefaultPrice: number;
  weddingIncludedHours: number;
  weddingIncludedKm: number;
  weddingExtraHourPrice: number;
  weddingExtraKmPrice: number;
  vipDefaultPrice: number;
  vipIncludedHours: number;
  vipIncludedKm: number;
  vipExtraHourPrice: number;
  vipExtraKmPrice: number;
  tripIncludedKm: number;
  tripExtraKmPrice: number;
  tripOtherPrices: Record<VehicleCategory, number>;
  originLabel: string;
  originLat: number;
  originLng: number;
  minTripMinutes: number;
  overnightLatestEndHour: number;
  freeCancellationHours: number;
  tempPasswordDays: number;
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

export type FleetStatus = "AVAILABLE" | "BOOKED" | "MAINTENANCE" | "RETIRED";
export type VehicleCategory = "CAR" | "VAN" | "BUS" | "TRUCK" | "CLASSIC" | "LUXURY";

export interface FleetItem {
  id: string;
  make: string;
  model: string;
  name: string;
  year: number;
  plateNumber: string;
  color: string;
  capacity: number;
  luggage: number;
  category: VehicleCategory;
  status: FleetStatus;
  retiredAt: string | null;
  basePrice: number;
  effectiveBasePrice: number;
  usesTypePrices: boolean;
  weddingPrice: number | null;
  vipPrice: number | null;
  effectiveWeddingPrice: number;
  effectiveVipPrice: number;
  coverImage: string | null;
  imagesCount: number;
  features: string[];
  drivers: { id: string; name: string; status: DriverStatus; isPrimary: boolean }[];
  upcomingBookings: number;
  nextMaintenance: { id: string; type: string; startDate: string; endDate: string } | null;
}

export interface FleetSummary {
  total: number;
  available: number;
  booked: number;
  maintenance: number;
  retired: number;
  withoutDriver: number;
}

export type MaintenanceState = "SCHEDULED" | "IN_PROGRESS" | "OVERDUE" | "DONE";

export interface FleetDetail {
  id: string;
  make: string;
  model: string;
  name: string;
  year: number;
  plateNumber: string;
  color: string;
  capacity: number;
  luggage: number;
  category: VehicleCategory;
  basePrice: number;
  pricePerKm: number;
  pricePerHour: number;
  description: string;
  features: string[];
  status: FleetStatus;
  retiredAt: string | null;
  retiredReason: string | null;
  typePrices: { basePrice: number; pricePerKm: number; pricePerHour: number };
  weddingPrice: number | null;
  vipPrice: number | null;
  defaultServicePrices: { wedding: number; vip: number };
  images: { id: string; imageUrl: string; isCover: boolean }[];
  drivers: { id: string; name: string; status: DriverStatus; rating: number; isPrimary: boolean }[];
  maintenance: { id: string; type: string; startDate: string; endDate: string; cost: number; notes: string | null; completedAt: string | null; state: MaintenanceState }[];
  upcomingBookings: { id: string; ref: string; bookingDate: string; startTime: string; endTime: string; status: BookingStatus; customer: { id: string; name: string } | null }[];
  stats: { completedTrips: number; revenue: number };
}

export type TeamRole = "SUPER_ADMIN" | "ADMIN";
export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  role: TeamRole;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
}

/** One row of the bookings page (same shape as a day's booking). */
export type BookingRow = DayDetails["bookings"][number];

export interface BookingSearch {
  items: BookingRow[];
  counts: Record<BookingStatus, number>;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

/** GET /bookings/:id/cancellation: what cancelling now does to the money paid. */
export interface CancellationTerms {
  paid: number;
  refund: number;
  kept: number;
  outcome: "REFUNDED" | "KEPT" | null;
  freeUntil: string;
  freeCancellationHours: number;
  overridden: boolean;
}

export type ServiceType = "WEDDING" | "TRIP" | "VIP";

export interface Destination {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  active: boolean;
  sortOrder: number;
  prices: Partial<Record<VehicleCategory, number>>;
  effectivePrices: Record<VehicleCategory, number>;
  includedKm: number | null;
  effectiveIncludedKm: number;
  bookings: number;
}

export interface PriceLine {
  code: "wedding" | "vip" | "trip" | "trip_other" | "extra_hours" | "extra_km" | "package_discount" | "referral_discount";
  amount: number;
  quantity?: number;
  unitPrice?: number;
  included?: number;
  name?: string;
  includedHours?: number;
  includedKm?: number;
}

export interface PricingCatalog {
  origin: { label: string; latitude: number; longitude: number };
  depositRate: number;
  destinations: { id: string; name: string; latitude: number; longitude: number; prices: Record<VehicleCategory, number>; includedKm: number }[];
}
