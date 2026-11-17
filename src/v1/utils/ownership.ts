import { isAdminRole } from "../constants/roles";
import { NotFoundException } from "./errors";

export const isAdmin = (user: any) => isAdminRole(typeof user?.role === "string" ? user.role : user?.role?.name);

/**
 * Throws 404 unless `user` is an admin or one of `ownerIds`. 404 rather than
 * 403 so record ids can't be probed.
 */
export const assertOwnerOrAdmin = (user: any, ownerIds: (string | null | undefined)[], what = "Record") => {
  if (isAdmin(user)) return;
  if (!user?.id || !ownerIds.includes(user.id)) throw new NotFoundException(`${what} not found`);
};
