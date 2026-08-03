# Winterthur Council Tools

> Various Tools for the Winterthur City Council.

The goal of this project is to provide a set of tools that can be used by the Winterthur City Council to improve their workflow and
decision-making processes. It will be available as part of a simple web application that can be accessed by council members and staff.
Currently, no backend is planned. If database is needed, it will be frontend only. No user login or authentication is planned.

Webpage language is german.

## Further Infos for the Council of Winterthur
- Has totally 60 members.
- Has usually two sessions every monday evening.
- Every member is part of a party. The parties right to left: SVP, FDP, Mitte, GLP, EDU, EVP, SP, Grüne, AL.
- Every member is part of a fraction. Small parties (less than 4) have to form a fraction together. This is EDU & EVP, and Grüne & AL.
- Almost every member is part of a commission. Commissions are responsible for specific topics and prepare the decisions for the council.


## Ideas
- Seating arrangements (implemented)
- Majority calculator, which party have to vote for a motion to pass 
- General present statistics (per party and/or overall: age, gender, length of service, municipal district, etc.)
- General historical statistics (per party and/or overall: amount of inquiries, etc.)
- Summary of next session
- Download of next session Agenda as Excel


## Databases
The data can be stored in a JSON file or a simple database.
The data has to be scraped from the official website of the council.

### Member database
A database of all members and their details is needed.
Members: https://parlament.winterthur.ch/stadtparlament/27428 (list of all members, navigates to the member details when click)
Member details: https://parlament.winterthur.ch/behoerdenmitglieder/XXXXXX

There should be the possibility to refresh the database.

The data should include the following fields:
- First Name
- Last Name
- E-Mail
- Address (Nullable)
- Party
- Birth Year
- Job
- Start Date
- Municipal District
- Inquiries
- Fraction
- Commissions (0-N)
- Links of Interest

### Inquiries database
A database of all inquiries and their details is needed.
Inquiries: https://parlament.winterthur.ch/politbusiness (2016 until now)

There should be the possibility to update the database with all newly created inquiries.

The data should include the following fields:
- Title
- Number
- Type
- Status
- Date of submission
- Latest date of response (Nullable)
- Inquiry authors
- ...


Other data sources:
Session protocols and next session: https://parlament.winterthur.ch/sitzung
Commissions: https://parlament.winterthur.ch/kommissionen

