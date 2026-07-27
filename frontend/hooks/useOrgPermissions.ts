import { useAuth } from "./useAuth";

export interface OrgPermissions {
  role: string | undefined;
  isOwner: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
  canManage: boolean;
  isMember: boolean;
}

export function useOrgPermissions(orgId: string | undefined): OrgPermissions {
  const { user } = useAuth();

  if (!user || !orgId) {
    return {
      role: undefined,
      isOwner: false,
      isAdmin: false,
      isManager: false,
      isStaff: false,
      canManage: false,
      isMember: false,
    };
  }

  const isGlobalStaff =
    user.role === "admin" || user.role === "rootAdmin" || user.role === "*" || user.role === "staff";

  const membership = user.orgs?.find((o) => String(o.id) === String(orgId));
  const role = membership?.orgRole;

  const isOwner = role === "owner";
  const isAdmin = role === "admin" || isOwner;
  const isManager = isAdmin;
  const isMember = !!role;

  const canManage = isManager || isGlobalStaff;

  return {
    role,
    isOwner,
    isAdmin,
    isManager,
    isStaff: isGlobalStaff,
    canManage,
    isMember,
  };
}