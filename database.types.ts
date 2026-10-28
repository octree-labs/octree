export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      credit_purchases: {
        Row: {
          amount_cents: number
          checkout_session_id: string
          created_at: string
          credits: number
          currency: string
          id: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          checkout_session_id: string
          created_at?: string
          credits: number
          currency?: string
          id?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          checkout_session_id?: string
          created_at?: string
          credits?: number
          currency?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      drafts: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          content: string
          created_at: string
          id: string
          project_id: string | null
          source: string | null
          title: string | null
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          content: string
          created_at?: string
          id?: string
          project_id?: string | null
          source?: string | null
          title?: string | null
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          content?: string
          created_at?: string
          id?: string
          project_id?: string | null
          source?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_preferences: {
        Row: {
          marketing_opt_out: boolean
          updated_at: string | null
          user_id: string
        }
        Insert: {
          marketing_opt_out?: boolean
          updated_at?: string | null
          user_id: string
        }
        Update: {
          marketing_opt_out?: boolean
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          id: string
          name: string
          project_id: string
          size: number | null
          type: string | null
          uploaded_at: string | null
          url: string | null
        }
        Insert: {
          id?: string
          name: string
          project_id: string
          size?: number | null
          type?: string | null
          uploaded_at?: string | null
          url?: string | null
        }
        Update: {
          id?: string
          name?: string
          project_id?: string
          size?: number | null
          type?: string | null
          uploaded_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          attachments: Json | null
          conversation_summary: Json | null
          created_at: string | null
          error: string | null
          id: string
          interaction_count: number | null
          last_assistant_response: string | null
          last_user_prompt: string | null
          latex: string | null
          message_history: Json | null
          prompt: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          conversation_summary?: Json | null
          created_at?: string | null
          error?: string | null
          id?: string
          interaction_count?: number | null
          last_assistant_response?: string | null
          last_user_prompt?: string | null
          latex?: string | null
          message_history?: Json | null
          prompt: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          attachments?: Json | null
          conversation_summary?: Json | null
          created_at?: string | null
          error?: string | null
          id?: string
          interaction_count?: number | null
          last_assistant_response?: string | null
          last_user_prompt?: string | null
          latex?: string | null
          message_history?: Json | null
          prompt?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      lifecycle_emails: {
        Row: {
          attempts: number
          email: string
          error: string | null
          id: string
          payload: Json | null
          ref: string
          resend_id: string | null
          sent_at: string
          template: string
          user_id: string
        }
        Insert: {
          attempts?: number
          email: string
          error?: string | null
          id?: string
          payload?: Json | null
          ref?: string
          resend_id?: string | null
          sent_at?: string
          template: string
          user_id: string
        }
        Update: {
          attempts?: number
          email?: string
          error?: string | null
          id?: string
          payload?: Json | null
          ref?: string
          resend_id?: string | null
          sent_at?: string
          template?: string
          user_id?: string
        }
        Relationships: []
      }
      paywall_hits: {
        Row: {
          created_at: string
          feature: string
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      project_zotero_sources: {
        Row: {
          collection_key: string | null
          created_at: string
          entries: Json
          last_sync_error: string | null
          last_sync_status: string
          last_synced_at: string | null
          owner_id: string
          owner_type: string
          project_id: string
          refs_bib: string
          source_url: string
          updated_at: string
        }
        Insert: {
          collection_key?: string | null
          created_at?: string
          entries?: Json
          last_sync_error?: string | null
          last_sync_status?: string
          last_synced_at?: string | null
          owner_id: string
          owner_type: string
          project_id: string
          refs_bib?: string
          source_url: string
          updated_at?: string
        }
        Update: {
          collection_key?: string | null
          created_at?: string
          entries?: Json
          last_sync_error?: string | null
          last_sync_status?: string
          last_synced_at?: string | null
          owner_id?: string
          owner_type?: string
          project_id?: string
          refs_bib?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_zotero_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_monitor_state: {
        Row: {
          check_name: string
          last_alert_at: string | null
          last_checked: string
          last_error: string | null
          since: string
          status: string
        }
        Insert: {
          check_name: string
          last_alert_at?: string | null
          last_checked?: string
          last_error?: string | null
          since?: string
          status?: string
        }
        Update: {
          check_name?: string
          last_alert_at?: string | null
          last_checked?: string
          last_error?: string | null
          since?: string
          status?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string | null
          id: string
          kind: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kind?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kind?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      project_export_unlocks: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          project_id: string
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          project_id: string
          stripe_session_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          project_id?: string
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_export_unlocks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_ats_reports: {
        Row: {
          created_at: string
          id: string
          job_description: string | null
          project_id: string
          report: Json
          tex_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_description?: string | null
          project_id: string
          report: Json
          tex_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_description?: string | null
          project_id?: string
          report?: Json
          tex_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_ats_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_purchases: {
        Row: {
          amount_cents: number | null
          checkout_session_id: string
          created_at: string
          credits: number
          currency: string | null
          id: string
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          checkout_session_id: string
          created_at?: string
          credits: number
          currency?: string | null
          id?: string
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          checkout_session_id?: string
          created_at?: string
          credits?: number
          currency?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          created_at: string
          id: string
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: string
        }
        Relationships: []
      }
      user_usage: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          daily_reset_date: string
          edit_count: number
          edit_credits: number
          free_generations_used: number
          generation_credits: number
          id: string
          is_pro: boolean
          monthly_edit_count: number
          monthly_reset_date: string
          onboarding_completed: boolean | null
          referral_source: string | null
          role: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string | null
          use_case: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          daily_reset_date?: string
          edit_count?: number
          edit_credits?: number
          free_generations_used?: number
          generation_credits?: number
          id?: string
          is_pro?: boolean
          monthly_edit_count?: number
          monthly_reset_date?: string
          onboarding_completed?: boolean | null
          referral_source?: string | null
          role?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          use_case?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          daily_reset_date?: string
          edit_count?: number
          edit_credits?: number
          free_generations_used?: number
          generation_credits?: number
          id?: string
          is_pro?: boolean
          monthly_edit_count?: number
          monthly_reset_date?: string
          onboarding_completed?: boolean | null
          referral_source?: string | null
          role?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          use_case?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_walkthroughs: {
        Row: {
          created_at: string
          dashboard_seen: boolean
          dashboard_seen_at: string | null
          editor_seen: boolean
          editor_seen_at: string | null
          generate_seen: boolean
          generate_seen_at: string | null
          generated_first_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dashboard_seen?: boolean
          dashboard_seen_at?: string | null
          editor_seen?: boolean
          editor_seen_at?: string | null
          generate_seen?: boolean
          generate_seen_at?: string | null
          generated_first_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          dashboard_seen?: boolean
          dashboard_seen_at?: string | null
          editor_seen?: boolean
          editor_seen_at?: string | null
          generate_seen?: boolean
          generate_seen_at?: string | null
          generated_first_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_edit_credits: {
        Args: { p_credits: number; p_user_id: string }
        Returns: number
      }
      admin_daily_signups: {
        Args: never
        Returns: {
          new_signups: number
          signup_date: string
        }[]
      }
      admin_weekly_signups: {
        Args: never
        Returns: {
          new_signups: number
          signup_week: string
        }[]
      }
      claim_lifecycle_retry: {
        Args: { p_email: string; p_max_attempts: number; p_ref?: string; p_template: string; p_user_id: string }
        Returns: boolean
      }
      consume_edit_credit: { Args: { p_user_id: string }; Returns: boolean }
      grant_credit_purchase: {
        Args: {
          p_amount_cents?: number
          p_checkout_session_id: string
          p_credits: number
          p_currency?: string
          p_user_id: string
        }
        Returns: number
      }
      consume_generation: { Args: { p_user_id: string }; Returns: string }
      grant_generation_credits: {
        Args: { p_credits: number; p_user_id: string }
        Returns: number
      }
      grant_export_unlock: {
        Args: {
          p_amount_cents: number
          p_project_id: string
          p_session_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      grant_generation_purchase: {
        Args: {
          p_amount_cents?: number | null
          p_checkout_session_id: string
          p_credits: number
          p_currency?: string | null
          p_user_id: string
        }
        Returns: number | null
      }
      increment_edit_count: { Args: { p_user_id: string }; Returns: boolean }
      refund_generation: {
        Args: { p_kind: string; p_user_id: string }
        Returns: boolean
      }
      update_user_subscription_status: {
        Args: {
          p_cancel_at_period_end: boolean
          p_current_period_end: string
          p_current_period_start: string
          p_stripe_customer_id: string
          p_stripe_subscription_id: string
          p_subscription_status: string
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
