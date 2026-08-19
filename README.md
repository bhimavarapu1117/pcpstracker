# PCPSTracker

This version supports:

 Employee login with Employee ID + PIN

 Start-day attendance

 GPS capture

 Site check-in/check-out

 Google Maps links

 Employee location tracking while the tracking page is open

 GPS accuracy recording

 Site/job names

 Automatic daily email report

 Admin dashboard data stored in Google Sheets

 Geofence validation for sites

 Employee location history

Important: This tracks location only while the employee has granted browser location permission and the tracking page is active. A normal Apps Script web app should not be treated as a guaranteed background GPS tracker when the phone/browser is closed. For true all-day background tracking, an Android app would be the better architecture.

/****
 * PEST CONTROL FIELD ATTENDANCE SYSTEM
 * Google Apps Script + Google Sheets + GPS
 ****/

const CONFIG = {
  ADMIN_EMAIL: "YOUR_EMAIL@gmail.com",

  // Tracking interval in milliseconds.
  // 60 seconds = 60000
  LOCATION_INTERVAL: 60000,

  // Default geofence radius in meters
  DEFAULT_GEOFENCE_RADIUS: 100
};


/****
 * WEB APP
 ****/

function doGet() {
  return HtmlService
    .createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Field Attendance")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/****
 * INITIAL SHEET SETUP
 ****/

function setupSystem() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheets = {
    Employees: [
      "Employee ID",
      "Name",
      "PIN",
      "Phone",
      "Email",
      "Active"
    ],

    Sites: [
      "Site ID",
      "Site Name",
      "Customer",
      "Address",
      "Latitude",
      "Longitude",
      "Radius Meters",
      "Active"
    ],

    Attendance: [
      "Timestamp",
      "Date",
      "Employee ID",
      "Employee Name",
      "Action",
      "Latitude",
      "Longitude",
      "Accuracy",
      "Google Maps",
      "Notes"
    ],

    SiteVisits: [
      "Timestamp",
      "Date",
      "Employee ID",
      "Employee Name",
      "Site ID",
      "Site Name",
      "Customer",
      "Action",
      "Latitude",
      "Longitude",
      "Accuracy",
      "Distance From Site (m)",
      "Within Geofence",
      "Google Maps",
      "Notes"
    ],

    LocationLogs: [
      "Timestamp",
      "Date",
      "Employee ID",
      "Employee Name",
      "Latitude",
      "Longitude",
      "Accuracy",
      "Google Maps"
    ]
  };

  Object.keys(sheets).forEach(name => {

    let sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
    }

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(sheets[name]);
    }

    sheet.setFrozenRows(1);
  });

  return "System setup completed.";
}


/****
 * EMPLOYEE LOGIN
 ****/

function loginEmployee(employeeId, pin) {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Employees");

  if (!sheet) {
    throw new Error("Employees sheet not found.");
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    const id = String(data[i][0]).trim();
    const employeeName = String(data[i][1]).trim();
    const employeePin = String(data[i][2]).trim();
    const active = String(data[i][5]).toLowerCase();

    if (
      id === String(employeeId).trim() &&
      employeePin === String(pin).trim() &&
      active === "true"
    ) {

      return {
        success: true,
        employeeId: id,
        name: employeeName
      };
    }
  }

  return {
    success: false,
    message: "Invalid Employee ID or PIN."
  };
}


/****
 * GET ACTIVE SITES
 ****/

function getSites() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Sites");

  if (!sheet) {
    return [];
  }

  const data = sheet.getDataRange().getValues();

  const sites = [];

  for (let i = 1; i < data.length; i++) {

    if (String(data[i][7]).toLowerCase() !== "true") {
      continue;
    }

    sites.push({
      siteId: data[i][0],
      siteName: data[i][1],
      customer: data[i][2],
      address: data[i][3],
      latitude: Number(data[i][4]),
      longitude: Number(data[i][5]),
      radius: Number(data[i][6]) || CONFIG.DEFAULT_GEOFENCE_RADIUS
    });
  }

  return sites;
}


/****
 * GET EMPLOYEE NAME
 ****/

function getEmployeeName(employeeId) {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Employees");

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    if (String(data[i][0]) === String(employeeId)) {
      return data[i][1];
    }
  }

  return "Unknown";
}


/****
 * GOOGLE MAPS LINK
 ****/

function createMapsLink(lat, lng) {

  return "https://www.google.com/maps?q=" +
    encodeURIComponent(lat + "," + lng);
}


/****
 * DISTANCE CALCULATION
 ****/

function calculateDistance(lat1, lon1, lat2, lon2) {

  const R = 6371000;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );

  return R * c;
}


function toRadians(degrees) {
  return degrees * Math.PI / 180;
}


/****
 * ATTENDANCE ACTION
 ****/

function recordAttendance(data) {

  if (!data.employeeId) {
    throw new Error("Employee ID required.");
  }

  const employeeName = getEmployeeName(data.employeeId);

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Attendance");

  const timestamp = new Date();

  const mapLink = createMapsLink(
    data.latitude,
    data.longitude
  );

  sheet.appendRow([
    timestamp,
    Utilities.formatDate(
      timestamp,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    ),
    data.employeeId,
    employeeName,
    data.action,
    data.latitude,
    data.longitude,
    data.accuracy,
    mapLink,
    data.notes || ""
  ]);

  return {
    success: true,
    message: data.action + " recorded successfully.",
    mapLink: mapLink
  };
}


/****
 * SITE VISIT
 ****/

function recordSiteVisit(data) {

  const employeeName = getEmployeeName(data.employeeId);

  const sites = getSites();

  const site = sites.find(
    s => String(s.siteId) === String(data.siteId)
  );

  if (!site) {
    throw new Error("Site not found.");
  }

  const distance = calculateDistance(
    Number(data.latitude),
    Number(data.longitude),
    Number(site.latitude),
    Number(site.longitude)
  );

  const withinGeofence =
    distance <= site.radius;

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("SiteVisits");

  const timestamp = new Date();

  const mapLink = createMapsLink(
    data.latitude,
    data.longitude
  );

  sheet.appendRow([
    timestamp,

    Utilities.formatDate(
      timestamp,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    ),

    data.employeeId,
    employeeName,

    site.siteId,
    site.siteName,
    site.customer,

    data.action,

    data.latitude,
    data.longitude,
    data.accuracy,

    Math.round(distance),

    withinGeofence ? "YES" : "NO",

    mapLink,

    data.notes || ""
  ]);

  return {
    success: true,
    withinGeofence: withinGeofence,
    distance: Math.round(distance),
    mapLink: mapLink
  };
}


/****
 * LOCATION TRACKING
 ****/

function recordLocation(data) {

  if (!data.employeeId) {
    throw new Error("Employee ID required.");
  }

  const employeeName =
    getEmployeeName(data.employeeId);

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("LocationLogs");

  const timestamp = new Date();

  const mapLink = createMapsLink(
    data.latitude,
    data.longitude
  );

  sheet.appendRow([
    timestamp,

    Utilities.formatDate(
      timestamp,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    ),

    data.employeeId,
    employeeName,

    data.latitude,
    data.longitude,
    data.accuracy,

    mapLink
  ]);

  return {
    success: true
  };
}


/****
 * DAILY REPORT
 ****/

function sendDailyReport() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const attendance =
    ss.getSheetByName("Attendance");

  const visits =
    ss.getSheetByName("SiteVisits");

  const employees =
    ss.getSheetByName("Employees");

  const today =
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );

  const attendanceData =
    attendance.getDataRange().getValues();

  const visitData =
    visits.getDataRange().getValues();

  const employeeData =
    employees.getDataRange().getValues();

  let present = {};
  let visitCount = {};

  employeeData.slice(1).forEach(row => {

    const id = String(row[0]);
    const name = row[1];

    if (String(row[5]).toLowerCase() === "true") {

      present[id] = {
        name: name,
        checkIn: "",
        checkOut: "",
        visits: 0
      };
    }
  });


  // Attendance
  attendanceData.slice(1).forEach(row => {

    const date =
      Utilities.formatDate(
        new Date(row[0]),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );

    if (date !== today) return;

    const employeeId = String(row[2]);
    const action = row[4];

    if (!present[employeeId]) {
      present[employeeId] = {
        name: row[3],
        checkIn: "",
        checkOut: "",
        visits: 0
      };
    }

    const time =
      Utilities.formatDate(
        new Date(row[0]),
        Session.getScriptTimeZone(),
        "hh:mm a"
      );

    if (action === "CHECK_IN") {
      present[employeeId].checkIn = time;
    }

    if (action === "CHECK_OUT") {
      present[employeeId].checkOut = time;
    }
  });


  // Site visits
  visitData.slice(1).forEach(row => {

    const date =
      Utilities.formatDate(
        new Date(row[0]),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );

    if (date !== today) return;

    const employeeId = String(row[2]);

    if (!present[employeeId]) {
      present[employeeId] = {
        name: row[3],
        checkIn: "",
        checkOut: "",
        visits: 0
      };
    }

    if (row[7] === "SITE_CHECK_IN") {
      present[employeeId].visits++;
    }
  });


  let html = `
  

Daily Field Attendance Report



  

Date: ${today}
  



  
  `;

  let totalPresent = 0;
  let totalVisits = 0;

  Object.keys(present).forEach(id => {

    const e = present[id];

    if (e.checkIn) {
      totalPresent++;
    }

    totalVisits += e.visits;

    html += `
    
    `;
  });

  html += `
  



  
    Employee
    Check In
    Check Out
    Site Visits
      ${e.name}
      ${e.checkIn || "-"}
      ${e.checkOut || "-"}
      ${e.visits}
    



  


  

Summary



  


  Employees Present: ${totalPresent}

  Total Site Visits: ${totalVisits}



  


  Open the Google Sheet for complete GPS history and Google Maps links.
  


  `;


  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: "Daily Pest Control Attendance - " + today,
    htmlBody: html
  });
}


/****
 * CREATE DAILY REPORT TRIGGER
 ****/

function createDailyReportTrigger() {

  const triggers =
    ScriptApp.getProjectTriggers();

  triggers.forEach(trigger => {

    if (
      trigger.getHandlerFunction() ===
      "sendDailyReport"
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });


  ScriptApp.newTrigger("sendDailyReport")
    .timeBased()
    .everyDays(1)
    .atHour(19)
    .create();

  return "Daily report trigger created.";
}
Take a reference of this app: https://www.jibble.io/attendance-tracker

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pcpstracker.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dca3e9b9-4d04-42ac-9153-f0760552f5ef).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
