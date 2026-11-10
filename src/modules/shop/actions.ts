"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/errors";
import { requireContext } from "@/modules/auth/guards";
import { updateSettings } from "./service";
import type { SettingsPatch } from "./schema";

/**
 * Server action behind the settings forms. The patch is validated by the
 * service (settingsPatchSchema); the role is checked there too.
 */
export async function updateSettingsAction(patch: SettingsPatch): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireContext(["OWNER"]);
    await updateSettings(ctx, patch);
    revalidatePath("/settings");
    return null;
  });
}
