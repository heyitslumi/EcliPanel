"use client"

import { useTranslations } from "next-intl";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { getActivityActionLabel } from "@/lib/activity-action-labels";
import {
  orgGuessType,
  orgTypeIcons,
  orgTypeColors,
  orgTypeBadgeColors,
} from "@/components/activity/helpers";
import { API_ENDPOINTS } from "@/lib/panel-config";
import { exportActivityLogs } from "@/lib/export-utils";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Server, Receipt, Shield, Activity } from "lucide-react";

interface ActivityTabProps {
  orgId: string;
  activity: any[];
  activityLoading: boolean;
  activityPage: number;
  activityHasMore: boolean;
  onLoadActivity: (page: number) => void;
  canExport?: boolean;
}

export function ActivityTab({
  orgId,
  activity,
  activityLoading,
  activityPage,
  activityHasMore,
  onLoadActivity,
  canExport = true,
}: ActivityTabProps) {
  const t = useTranslations("organisationsDetailPage");

  const handleExport = async (format: "csv" | "json", filter: string | null) => {
    try {
      await exportActivityLogs({
        url: API_ENDPOINTS.organisationLogsExport.replace(":id", orgId),
        format,
        filter,
        guessTypeFn: orgGuessType,
        filenamePrefix: `organisation-activity-${orgId}`,
      });
      toast({ title: t("export.success") });
    } catch (e) {
      toast({ title: t("export.failed"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <ActivityFeed
      logs={activity}
      loading={activityLoading}
      getActionLabel={(action) =>
        getActivityActionLabel(action, {
          "org:create": t("activity.actions.orgCreate"),
          "org:add_user": t("activity.actions.orgAddUser"),
          "org:remove_member": t("activity.actions.orgRemoveMember"),
          "org:change_role": t("activity.actions.orgChangeRole"),
          "org:invite": t("activity.actions.orgInvite"),
          "org:resend_invite": t("activity.actions.orgResendInvite"),
          "org:revoke_invite": t("activity.actions.orgRevokeInvite"),
          "org:accept_invite": t("activity.actions.orgAcceptInvite"),
          "server:create": t("activity.actions.serverCreate"),
          "server:delete": t("activity.actions.serverDelete"),
          "server:update": t("activity.actions.serverUpdate"),
          "server:suspend": t("activity.actions.serverSuspend"),
          "server:unsuspend": t("activity.actions.serverUnsuspend"),
        })
      }
      guessTypeFn={orgGuessType}
      typeIconsMap={orgTypeIcons}
      typeColorsMap={orgTypeColors}
      typeBadgeColorsMap={orgTypeBadgeColors}
      page={activityPage}
      hasMore={activityHasMore}
      onPrevPage={() => onLoadActivity(Math.max(1, activityPage - 1))}
      onNextPage={() => onLoadActivity(activityPage + 1)}
      onRefresh={() => onLoadActivity(activityPage)}
      refreshing={activityLoading}
      onExport={canExport ? handleExport : undefined}
      translate={t}
      filterOptions={[
        { key: "member", label: t("filters.member"), icon: UserPlus },
        { key: "server", label: t("filters.server"), icon: Server },
        { key: "billing", label: t("filters.billing"), icon: Receipt },
        { key: "security", label: t("filters.security"), icon: Shield },
        { key: "support", label: t("filters.support"), icon: Activity },
      ]}
    />
  );
}