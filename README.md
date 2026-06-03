This is built specifically for IMA Accelerator Appointment Setters for both Inbound and Outbound calls tracking.

You just needs to install it and enter your own API key in the popup. 

The extension uses the API key to identify who's logged in (/api/v1/me/) and then pulls stats specific to that user's ID. 

So each rep will see their own dials, pick ups, triaged leads, etc.

To use it:

They unzip it, go to chrome://extensions, enable Developer mode, click Load unpacked, and select the folder
They click the extension icon and enter their own Close CRM API key
Their API key can be generated in Close CRM under Settings → API Keys.

What it tracks:

DIALS — outbound calls today (from Close reports, matches UI)
PICK UPS — answered calls ≥60s
TALK TIME — total outbound call duration
PICK UP RATE — pick ups / dials
MEANINGFUL — answered calls ≥5 mins
TRIAGED — leads you DQ'd today across all triaged statuses
OUTBOUND — brand new outbound leads (Potential/Webinar Scored) you first contacted today
SELF BOOK — brand new self-booking leads (Unconfirmed/Webinar Booked Appt) you first contacted today
