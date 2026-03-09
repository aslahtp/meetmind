# GCS setup for Speech-to-Text v2 BatchRecognize

MeetMind can use **Speech-to-Text v2 BatchRecognize** for long meetings without chunking. BatchRecognize only accepts audio from **Google Cloud Storage** (GCS). This guide sets up the bucket and credentials.

---

## Overview


| Who / What                 | Purpose                                            | Access needed                                             |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| **Your app (MeetMind)**    | Upload WAV to GCS, then delete after transcription | **Write + Delete** on the bucket (or a folder in it)      |
| **Speech-to-Text service** | Read the WAV from GCS to transcribe                | **Read** on the bucket (same project = usually automatic) |


You will:

1. Create a GCS bucket (same project as Speech-to-Text).
2. Create a **service account** for MeetMind with access to that bucket.
3. Download the service account **JSON key** and point MeetMind to it.
4. Ensure the **Speech-to-Text service agent** can read from the bucket (same project is enough in most cases).

---

## 1. Prerequisites

- A **Google Cloud project** with **Speech-to-Text API** enabled.
- **Billing** enabled on the project (required for Speech-to-Text and GCS).

---

## 2. Create the bucket

1. Open [Google Cloud Console](https://console.cloud.google.com) and select your project.
2. Go to **Cloud Storage** → **Buckets** ([direct link](https://console.cloud.google.com/storage/browser)).
3. Click **Create bucket**.
4. Choose a **name** (e.g. `meetmind-transcribe`) and a **region** (same as or close to your usage).
5. Leave **Uniform** access control (recommended).
6. Click **Create**.

---

## 3. Create a service account for MeetMind

The app needs an identity that can upload and delete objects in the bucket.

1. Go to **IAM & Admin** → **Service Accounts** ([direct link](https://console.cloud.google.com/iam-admin/serviceaccounts)).
2. Click **Create service account**.
3. **Service account name**: e.g. `meetmind-upload`.
4. Click **Create and Continue**.
5. **Grant access** (optional but recommended for least privilege):
  - Click **Add another role**.
  - Choose **Cloud Storage** → **Storage Object Admin** (or **Storage Object Creator** + **Storage Object Deleter**).
  - Under “Limit access to specific resources”, click **Limit access**, choose **Bucket**, select your bucket (e.g. `meetmind-transcribe`).  
  - Alternatively, skip limiting and the SA will have access to all buckets in the project; you can restrict later.
6. Click **Done**.

---

## 4. Create and download the JSON key

1. On the **Service Accounts** list, click the service account you created (e.g. `meetmind-upload`).
2. Open the **Keys** tab.
3. **Add key** → **Create new key** → **JSON** → **Create**.
4. The JSON file downloads. Store it somewhere safe (e.g. `C:\Users\<You>\.config\meetmind\gcs-key.json`).
5. In MeetMind **Settings**, set **Service account key path** to this file path (e.g. `C:\Users\You\.config\meetmind\gcs-key.json`).

**Alternative:** Set the environment variable `GOOGLE_APPLICATION_CREDENTIALS` to the full path of this JSON file. Then you can leave the key path empty in MeetMind.

---

## 5. Let Speech-to-Text read from the bucket

The Speech-to-Text service uses a **service agent** in your project to read objects from GCS.

- **Bucket in the same project:** The Speech-to-Text service agent usually has access to buckets in the same project. No extra step needed in most cases.
- **Bucket in another project, or if you see “permission denied”:** Grant the agent **Storage Object Viewer** on the bucket.

To find the agent and grant access:

1. Go to **IAM & Admin** → **IAM** ([direct link](https://console.cloud.google.com/iam-admin/iam)).
2. Find the principal:
  `service-PROJECT_NUMBER@gcp-sa-speech.iam.gserviceaccount.com`  
   (Replace `PROJECT_NUMBER` with your project number: **Home** → **Dashboard** → project number.)
3. If it’s not there, go to **Cloud Storage** → **Buckets** → your bucket → **Permissions**.
4. **Grant access**:
  - **New principals:** `service-PROJECT_NUMBER@gcp-sa-speech.iam.gserviceaccount.com`
  - **Role:** **Storage Object Viewer**
5. Save.

---

## 6. Configure MeetMind

In MeetMind **Settings**:


| Field                                   | Value                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Google Cloud API Key**                | Your Speech-to-Text API key (unchanged).                                                  |
| **Google Cloud Project ID**             | Your GCP project ID (e.g. `my-project-123`).                                              |
| **GCS bucket (optional)**               | Bucket name only (e.g. `meetmind-transcribe`).                                            |
| **Service account key path (optional)** | Full path to the JSON key file, or leave empty if using `GOOGLE_APPLICATION_CREDENTIALS`. |


With **Project ID** and **GCS bucket** set, MeetMind will use **BatchRecognize** for all v2 transcriptions (no chunking). If the bucket is left empty, v2 will use chunked sync recognize instead.

---

## 7. Quick checklist

- Project has Speech-to-Text API enabled and billing on.
- GCS bucket created (e.g. `meetmind-transcribe`).
- Service account created with **Storage Object Admin** (or Creator + Deleter) on that bucket.
- JSON key downloaded and path set in MeetMind (or `GOOGLE_APPLICATION_CREDENTIALS` set).
- Speech-to-Text service agent has **Storage Object Viewer** on the bucket (automatic when bucket is in same project in most cases).
- MeetMind Settings: **Project ID** and **GCS bucket** filled in.

---

## Troubleshooting


| Error                                       | What to check                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Permission denied** on upload             | Service account has **Storage Object Admin** (or Creator) on the bucket; key path or `GOOGLE_APPLICATION_CREDENTIALS` is correct. |
| **Permission denied** during BatchRecognize | Speech-to-Text service agent has **Storage Object Viewer** on the bucket (see step 5).                                            |
| **Bucket not found**                        | Bucket name in Settings is correct (no `gs://`), and the bucket is in the same project as the API key / project ID.               |
| **Invalid key file**                        | Path is absolute and the JSON file is the unmodified key you downloaded.                                                          |


