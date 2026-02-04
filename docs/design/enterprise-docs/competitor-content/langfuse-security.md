# Langfuse Security & Compliance Documentation

*Source: https://langfuse.com/security (and related sub-pages)*
*Scraped: February 2026*

---

## Table of Contents

1. [Security & Compliance Overview](#security--compliance-overview)
2. [Authentication & Authorization](#authentication--authorization)
3. [Encryption](#encryption)
4. [Data Regions & Availability](#data-regions--availability)
5. [Technical and Organisational Measures (TOMs)](#technical-and-organisational-measures-toms)
6. [Compliance - SOC 2 Type II](#soc-2-type-ii-compliance)
7. [Compliance - ISO 27001](#iso-27001-compliance)
8. [Compliance - HIPAA](#hipaa-compliance--business-associate-agreement-baa)
9. [Privacy - GDPR](#gdpr-compliance)
10. [Privacy - Managing Personal Data](#managing-personal-data)
11. [Privacy - DPA](#data-processing-agreement-dpa)
12. [Privacy - Subprocessors](#subprocessors)

---

## Security & Compliance Overview

**At Langfuse, we prioritize data privacy and security.** We understand that the data you entrust to us is a vital asset to your business, and we treat it with the utmost care.

We take active steps to demonstrate our commitment to data security and privacy such as annual SOC2 Type 2 and ISO27001 audits as well as External Penetration Tests. You can request access to the reports.

Langfuse is built with enterprise needs in mind, focusing on:

- **Security Measures:** Robust Encryption, access controls, and regular Penetration Testing.
- **Privacy Measures:** Protecting user data according to regulations like GDPR. We offer a DPA, BAA, and adhere to our Privacy Policy.
- **Transparency:** Open-source core and clear information on software dependencies.
- **Reporting:** Clear channels for Responsible Disclosure and Whistleblowing.

Langfuse is the most widely adopted LLM Engineering platform with **21,496 GitHub stars**, **23.1M+ SDK installs per month**, and **6M+ Docker pulls**. Trusted by **19 of the Fortune 50** and **63 of the Fortune 500** companies.

### Compliance

We maintain internal policies and adhere to several industry-standard compliance frameworks:

- SOC 2 Type II
- ISO 27001
- HIPAA

### Privacy

Langfuse is GDPR compliant, and offers data retention, data masking and data deletion capabilities to manage the processing of personal data. You can enter into a DPA with Langfuse.

### Contact

- Use Ask AI to get instant answers to your questions.
- For security inquiries: security@langfuse.com
- For privacy inquiries: privacy@langfuse.com
- For compliance inquiries: compliance@langfuse.com

### General Information on Langfuse

#### What is Langfuse?

Langfuse is an **open-source LLM engineering platform** that provides tracing, prompt management, evaluation, and metrics to help teams debug and continuously improve LLM-based applications.

#### What deployment models are available?

- **Langfuse Cloud** – fully-managed SaaS (multi-tenant) with US, EU and HIPAA data regions
- **Self-hosted OSS** – MIT-licensed software that you can deploy on your own infrastructure
- **Self-hosted Enterprise Edition** – commercial license with additional security/compliance features and vendor support.

#### Which cloud provider and regions do you use?

Langfuse Cloud mainly runs on **AWS and Clickhouse via AWS**:

- **US region**: us-west-2 (Oregon)
- **EU region**: eu-west-1 (Ireland)

Self-hosted customers can choose any region / provider. Langfuse Self-Hosted can be run fully offline/air-gapped.

---

## Authentication & Authorization

Langfuse provides robust mechanisms for both authenticating users and authorizing their access to specific resources within the platform.

### Authentication

Authentication verifies the identity of a user attempting to access Langfuse.

- Authentication & SSO on Langfuse Cloud
- Authentication & SSO (self-hosted)

### Authorization (RBAC)

Langfuse supports Role-based Access Control (RBAC) with detailed explanation of roles, permissions, and how to manage user access within organizations and projects.

---

## Encryption

Langfuse employs robust encryption methods to protect your data both while it's being transferred and while it's stored.

This page describes the encryption practices for Langfuse Cloud. For self-hosted deployments, please refer to the Self-hosting Guide.

### Encryption in Transit

All data transferred between your applications, the Langfuse SDKs, and the Langfuse server is encrypted using **TLS 1.2 (Transport Layer Security)**. This ensures that data is protected from eavesdropping or tampering during transmission.

### Encryption at Rest

Data stored within the Langfuse infrastructure is encrypted at rest using **AES-256**, a strong industry-standard encryption algorithm.

This applies to data stored in:

| Service | Encryption Standard |
|---------|---------------------|
| Elasticache (Redis) | AES-256 |
| Aurora (Postgres) | AES-256 |
| Clickhouse | AES-256 |
| S3 / Blob Storage | AES-256 |

### Contact

For questions regarding encryption practices, please contact security@langfuse.com.

---

## Data Regions & Availability

Langfuse Cloud is designed for high availability and offers multiple data regions to meet your needs.

Our database and application run on AWS infrastructure, partly managed by Clickhouse.

### Langfuse Cloud Regions

All data, user accounts, and infrastructure are completely separated between the regions. You can have accounts in each regions.

| Region | URL | Location |
|--------|-----|----------|
| **US** | `https://us.cloud.langfuse.com` | Oregon (AWS `us-west-2`) |
| **EU** | `https://cloud.langfuse.com` | Ireland (AWS `eu-west-1`) |
| **HIPAA** | `https://hipaa.cloud.langfuse.com` | Oregon (AWS `us-west-2`) |

### Connecting to a Region

To connect to a specific data region using the Langfuse SDKs, you need to set the base URL environment variable or pass it during initialization:

- **Python:** Set `LANGFUSE_BASE_URL` environment variable or use the `base_url` parameter.
- **JS/TS:** Set `LANGFUSE_BASEURL` environment variable or use the `baseUrl` parameter.

Example base URLs:
- US: `https://us.cloud.langfuse.com`
- EU: `https://cloud.langfuse.com`
- HIPAA: `https://hipaa.cloud.langfuse.com`

### Choosing a Region

When selecting a data region, consider the following factors:

- **Compliance and data privacy requirements:** Choose the region that aligns with your organization's data residency needs (e.g., GDPR often favors the EU region).
- **Latency for Prompt Management:** If using Langfuse Prompt Management, select the region closer to your application servers for lower latency when fetching prompts.
- **Latency for UI access:** Choose the region closer to your team's location for a faster experience when using the Langfuse web interface.

Less critical factor:
- **Tracing ingestion latency:** Trace data is sent asynchronously in batches, making ingestion latency less of a direct concern for application performance.

### Business Continuity & Availability

| Control | Details |
|---------|---------|
| **High availability** | Multi-AZ databases & load-balanced stateless application layer on AWS. |
| **Disaster recovery** | Encrypted backups stored cross-region; tested at least annually |
| **Status page** | https://status.langfuse.com with historical uptime and incidents. |

For our cloud service, we have a RTO of 12h and RPO of 10min.

### Self-hosted Instances

Alternatively, you can self-host Langfuse for full control over your data and infrastructure.

---

## Technical and Organisational Measures (TOMs)

Langfuse implements the following technical and organisational measures (TOMs) to protect the confidentiality, integrity, and availability of data.

**Latest revision:** October 17th, 2025

### 1. Confidentiality

#### 1.1 Physical Access Control

> Preventing unauthorised persons from gaining access to data-processing systems.

*Technical Measures*
- Locking systems
- Lockable storage containers

*Organisational Measures*
- Physical Security Policy
- Visitors accompanied by employees
- Information Security Policy

#### 1.2 Logical Access Control

> Preventing data-processing systems from being used by unauthorised persons.

*Technical Measures*
- Login with username and strong password or SSO where available
- Encryption of devices
- Enforced MFA where applicable
- Automatic desktop lock

*Organisational Measures*
- User-permission management
- Creating user profiles
- Information Security Policy

#### 1.3 Authorisation Control

> Ensuring employees can only access data subject to their authorisation and cannot read, copy, modify or remove Personal Data without permission.

*Technical Measures*
- Logging of access to applications or databases (entering, changing, deleting data)
- SSH-encrypted access
- TLS encryption in transit

*Organisational Measures*
- Minimum number of administrators
- Management of user rights by administrators
- No shared accounts where technically feasible
- Information Security Policy

#### 1.4 Separation Control

> Ensuring data collected for different purposes is processed separately.

*Technical Measures*
- Separation of production and test environments
- Multi-tenancy of relevant applications

*Organisational Measures*
- Control via authorisation concept
- Determination of database rights
- Information Security & Data-Protection Policies

### 2. Integrity

#### 2.1 Transfer Control

> Ensuring Personal Data cannot be read, copied, altered or removed by unauthorised persons during electronic transmission or transport/storage on media.

*Technical Measures*
- Provision via encrypted connections (SFTP, HTTPS, secure cloud stores)

*Organisational Measures*
- Information Security & Data-Protection Policies

#### 2.2 Input Control

> Ability to verify whether and by which user Personal Data has been entered, modified or removed.

*Technical Measures*
- Manual or automated logging of database access
- Traceability through individual user names (not groups)

*Organisational Measures*
- Assignment of rights based on an authorisation concept
- Information Security Policy

### 3. Availability and Resilience

#### 3.1 Availability Control

> Protecting Personal Data against accidental destruction or loss.

*Technical Measures*
- Hosting in certified data centres by reputable cloud providers (e.g. AWS)
- Using multiple availability zones within a cloud region
- Backup concept
- Use of as many fully managed services as feasible to reduce downtimes
- Monitoring and alerting for capacity and functioning of core processes
- Using highly available and horizontally scalable architectures where possible

*Organisational Measures*
- Business continuity and disaster-recovery plan
- Information Security Policy

#### 3.2 Recoverability Control

> Rapid restoration of availability and access after an incident.

*Technical Measures*
- Backup monitoring and reporting
- Automated restoration tools
- Regular recovery tests with logged results

*Organisational Measures*
- Recovery concept aligned to data criticality and Client specs
- Information Security Policy

### 4. Regular Review, Assessment and Evaluation

#### 4.1 Data-Protection Management

- Central documentation of data-protection regulations accessible to employees
- Privacy Officer appointed
- Annual review of TOMs and updates
- Staff trained and bound to confidentiality
- Regular awareness trainings
- Processes for information obligations (Art 13/14 GDPR)
- Formal DSAR process
- Data protection in corporate risk management

#### 4.2 Incident Response Management

- Email security gateway, anti-malware, and filtering controls with regular updates
- Documented incident-response process covering authority notifications
- Formalised procedure for handling incidents
- Involvement of Privacy Officer and CTO
- Ticket-based documentation and follow-up of incidents

#### 4.3 Data Protection by Design and Default

- No more Personal Data collected than necessary
- Privacy-friendly default settings in software

#### 4.4 Order Control (Sub-Processors)

- Vendor due-diligence and DPAs/SCCs in place
- Monitoring of subcontractors
- Audit rights over contractors
- Secure deletion of data after contract end

### 5. Organisation and Staff

- Information-security as a core corporate objective
- Employees bound to confidentiality and data secrecy
- External parties subject to NDA before work commences

---

## SOC 2 Type II Compliance

Langfuse Cloud has successfully completed the **SOC 2 Type II audit**.

- **Status:** Certified
- **Report Availability:** The SOC 2 Type II report is available upon request for customers on the Pro, Team, or Enterprise plans.
- **Request Access:** You can request access to the report.

### Contact

For questions regarding SOC 2 compliance, please contact compliance@langfuse.com.

---

## ISO 27001 Compliance

Langfuse Cloud is **ISO 27001 certified**. This international standard specifies the requirements for establishing, implementing, maintaining, and continually improving an information security management system (ISMS).

- **Status:** Certified
- **Certificate Availability:** The ISO 27001 certificate is available upon request for customers on the Pro, Team, or Enterprise plans.
- **Request Access:** You can request access to the certificate.

### Contact

For questions regarding ISO 27001 compliance, please contact compliance@langfuse.com.

---

## HIPAA Compliance & Business Associate Agreement (BAA)

Langfuse Cloud is aligned with **HIPAA**, enabling healthcare organizations and partners to use Langfuse while adhering to the requirements of the Health Insurance Portability and Accountability Act (HIPAA). Langfuse offers a Business Associate Agreement (BAA) to cover the safeguarding of Protected Health Information (PHI). For questions regarding HIPAA compliance, please contact compliance@langfuse.com.

### How to get set up on Langfuse HIPAA Cloud

1. You need a fresh Langfuse Cloud account on our HIPAA data region. *(Please note that this Langfuse instance is completely separate from our US and EU data region. Data migration is possible)*
2. Sign up at hipaa.cloud.langfuse.com
3. Review BAA below
4. Upgrade to Pro plan or higher
5. BAA applies automatically
6. You're good to go!

### Langfuse - Business Associate Agreement (BAA)

**Latest revision:** October 17th, 2025

**At a glance** — This applies only if you're on our HIPAA Cloud with a HIPAA-eligible plan. It governs how we handle PHI: we act as your Business Associate under HIPAA, safeguard PHI with strict security and access controls, and only use it to run the Solution or as required by law. You stay responsible for configuring use correctly and limiting PHI to what's necessary. We notify you within 72 hours of any breach, help with regulatory obligations, and flow down the same protections to our subcontractors (with 30-day advance notice for any subprocessor changes). When the contract ends, we delete or return PHI (with limited exceptions for backups/legal holds). Liability follows the main contract.

#### Important Eligibility Notice

This Business Associate Agreement ('BAA') automatically applies only to Langfuse Client accounts that:

- are hosted in the Langfuse HIPAA Cloud Region at https://hipaa.cloud.langfuse.com/; and
- are subscribed to a Pro, Teams, or Enterprise plan (each a 'HIPAA-Eligible Plan').

Accounts that do not meet both conditions are not covered by this BAA and may not process Protected Health Information ('PHI') with Langfuse.

#### 1. Parties & Incorporation

This BAA supplements and is incorporated by reference into the Langfuse Cloud Terms and Conditions (T&Cs), Order Form and/or any other written contract governing Client's use of the HIPAA-eligible Langfuse Environment (collectively, the 'Main Contract').

**Precedence.** If there is a conflict on the same subject matter: (1) for PHI, the BAA controls; (2) for Personal Data (excluding PHI), the DPA controls; otherwise, the T&Cs control. Where information qualifies as both PHI and Personal Data, the BAA controls and the DPA applies only where not inconsistent with the BAA.

#### 2. Definitions

Capitalized terms have the meanings set out in the U.S. Health Insurance Portability and Accountability Act of 1996 and its implementing regulations (45 C.F.R. Parts 160 & 164), as amended by the HITECH Act (together, 'HIPAA'). Key terms include:

| Term | Meaning |
|------|---------|
| **PHI / Protected Health Information** | Has the meaning in 45 C.F.R. §160.103 and is limited to information created, received, maintained or transmitted by Langfuse on behalf of Client. |
| **Breach** | As defined in 45 C.F.R. §164.402 — the unlawful acquisition, access, use or disclosure of Unsecured PHI. |
| **Security Incident** | As defined in 45 C.F.R. §164.304. |
| **HITECH Act** | Title XIII of the American Recovery and Reinvestment Act of 2009. |

#### 3. Permitted Uses & Disclosures

Langfuse may use or disclose PHI only:

- To provide the HIPAA Cloud Region environment and related support in accordance with the Main Contract;
- For our own management or legal obligations, provided any disclosure is (i) required by law or (ii) to a recipient that agrees to written confidentiality protections and promptly reports any breach; and
- As otherwise required by law.

Langfuse will not use or disclose PHI for any other purpose without Client's written instruction.

**No De-Identification Without Instruction.** Langfuse will not use PHI to create de-identified or aggregated datasets except (i) as expressly instructed in writing by Client or (ii) as required for security, fraud prevention, or legal compliance and only in accordance with 45 C.F.R. §164.514.

#### 4. Client Responsibilities

Client represents, warrants and agrees that:

- **Status.** Client is, and will remain, a Covered Entity or Business Associate under HIPAA and will comply with HIPAA in its use of the Services.
- **Minimum-Necessary & Configuration.** Client will (a) limit PHI uploaded to the Service to the minimum necessary, (b) refrain from sending PHI via support tickets, email, or non-HIPAA workspaces, and (c) follow Langfuse documentation regarding encryption and other HIPAA configuration.
- **No Impermissible Requests.** Client will not request Langfuse to use or disclose PHI in a manner that would violate HIPAA if performed by Client.
- **Consents.** Client is responsible for obtaining any authorisations or consents required for Langfuse's uses and disclosures of PHI.

#### 5. Safeguards

Langfuse will:

- Implement administrative, physical and technical safeguards that reasonably and appropriately protect the confidentiality, integrity and availability of electronic PHI in accordance with the HIPAA Security Rule;
- Maintain a written information-security program including risk assessments, encryption in transit and at rest, access controls, logging and vulnerability management; and
- Ensure that workforce members with access to PHI are bound by confidentiality obligations and trained on HIPAA requirements.

**Data Location & Workforce Access.** PHI is stored in the United States of America. Trained Langfuse workforce members may remotely access PHI from outside the United States solely as necessary to provide the Services and support, subject to least-privilege access controls, MFA, logging, and confidentiality obligations.

**Incorporation of TOMs.** The technical and organizational measures in DPA Annex 2 are incorporated by reference and apply to PHI processed in the HIPAA Cloud.

#### 6. Subcontractors

Langfuse will ensure that any Subcontractor that creates, receives, maintains or transmits PHI on Langfuse's behalf agrees, in writing, to restrictions and security obligations at least as protective as those in this BAA and the HIPAA Security Rule.

Langfuse remains responsible for each Subcontractor's compliance and is liable for their acts and omissions relating to PHI to the same extent as if performed by Langfuse.

Langfuse maintains a public list of Subcontractors that Process PHI in the HIPAA Cloud at langfuse.com/security/subprocessors and will provide at least 30 days' prior email notice before adding or replacing any such Subcontractor.

#### 7. Incident & Breach Reporting

Langfuse will:

- Report to Client any Breach of Unsecured PHI or unauthorized use or disclosure of PHI without unreasonable delay and in no event later than 72 hours after discovery;
- Report Security Incidents that materially compromise PHI; and
- Provide available information to assist Client in complying with 45 C.F.R. §§164.404–410.

**Cooperation.** Following a Breach of Unsecured PHI, the parties will cooperate in good faith on investigation, risk assessment, and required notifications under 45 C.F.R. §§164.400–414.

#### 8. Individual Rights

To enable Client's obligations under 45 C.F.R. §164.528, Langfuse shall document and, upon written request, provide the information required by §164.528(b) for disclosures of PHI made by Langfuse. Langfuse will provide this information within 15 business days of Client's written request.

#### 9. Books & Records

Langfuse will make its relevant policies, procedures and records relating to the security or use of PHI available to the U.S. Department of Health & Human Services upon request, subject to attorney-client privilege and trade-secret protections.

#### 10. Term & Termination

**Term.** This BAA is coterminous with the Main Contract. It becomes effective automatically when Client first creates or upgrades an account that satisfies the eligibility criteria.

**Termination for Breach.** Either party may terminate this BAA immediately upon written notice if the other party materially breaches and the breach is not curable, or upon 30 days' written notice if curable and not cured within that period.

**Return/Destruction of PHI.** Upon termination, Langfuse will return or destroy PHI within 30 days. If any PHI is retained solely in immutable backups, system logs, or subject to legal hold, destruction may be infeasible until those media roll off in the ordinary course.

**Survival.** Langfuse's obligations under this BAA survive until all PHI provided by or on behalf of Client is returned or destroyed.

#### 11. Miscellaneous

- **No Third-Party Beneficiaries.** Nothing in this BAA confers rights on anyone other than the parties.
- **Amendment.** Langfuse may update this BAA prospectively by posting a revised version and providing at least 30 days' notice.
- **Liability.** Each party's liability under this BAA is subject to the limitations in the Main Contract, except that HIPAA fines imposed due to a party's breach are borne by that party.
- **Governing Law.** Unless the Main Contract states otherwise, this BAA is governed by the same law and dispute forum as the Main Contract.

---

## GDPR Compliance

Langfuse is committed to complying with the General Data Protection Regulation (GDPR). We ensure that personal data is processed lawfully, fairly, and transparently.

More information:
- Langfuse DPA
- Managing processing of personal data (within Langfuse)
- Privacy Policy for details on how we handle personal data

### Contact

For questions regarding GDPR compliance or data privacy, please contact privacy@langfuse.com.

### Data Subject Access Request (DSAR)

Under applicable data protection laws, you may have the right to request access to and receive information about the personal data we maintain about you, to update and correct inaccuracies in your personal data, to restrict or object to the processing of your personal data, to have the information anonymized or deleted, as appropriate, or to exercise your right to data portability.

To submit a Data Subject Access Request, please email us at privacy@langfuse.com. We will respond to your request within the time limits established by applicable law.

---

## Managing Personal Data

It is up to you to decide which kind of personal data you want to process with Langfuse. You can manage how personal data is processed and retained via:

- **Data masking:** Mask PII data in traces, observations, and scores.
- **Data deletion:** Delete personal data upon request; add userIds to tracing data to facilitate efficient deletion.
- **Data retention:** Control how long data is stored in Langfuse.

---

## Data Processing Agreement (DPA)

**Latest revision:** October 17th, 2025

**At a glance** — You (as *Controller*) remain in control of your data; Langfuse (as *Processor*) only uses it to run the Solution, keeps it secure under industry-standard TOMs, and allows you to delete it or deletes it when you ask us to or leave us. If we need new subprocessors or make material changes, we will let you know 30 days in advance.

### Applicability Notice

This DPA is available for any Client of the Langfuse Cloud platform (EU Cloud at https://cloud.langfuse.com, US Cloud at https://us.cloud.langfuse.com, HIPAA Cloud at https://hipaa.cloud.langfuse.com) and any subscription tier (Hobby, Core, Pro, Teams, Enterprise). It forms part of and is incorporated by reference into the applicable T&Cs or other agreement governing use of the Langfuse platform (the 'Main Contract').

References to specific statutes (e.g., GDPR Articles 32–36) apply where those laws govern. Where another Applicable Data-Protection Law applies instead, the Parties intend the provision to be interpreted to the materially equivalent requirement under that law.

**Questions?** Email privacy@langfuse.com

### 1. Preamble & Incorporation

This Data Processing Agreement ('DPA') describes how Langfuse GmbH ('Langfuse', 'we', 'us') processes Personal Data on behalf of the Client ('you').

This DPA supplements and is incorporated by reference into Langfuse's Terms and Conditions ('T&Cs') or other agreement governing use of the Langfuse platform (collectively, the 'Main Contract').

It is intended to, inter alia, satisfy the requirements of:

- **Regulation (EU) 2016/679** (*EU GDPR*),
- the **UK GDPR** as defined in the UK Data Protection Act 2018, and
- the **California Consumer Privacy Act of 2018** (together with the California Privacy Rights Act of 2020, the *CCPA*)
- and **any other national or U.S. State data-protection laws** that implement or supplement the foregoing (collectively, 'Applicable Data-Protection Laws').

**Applicability.** This DPA applies to **all** Clients that Process Personal Data via the Solution. Sections on fees or cost-sharing apply only where you have a paid subscription.

**Precedence.** If there is a conflict between this DPA and the Main Contract, **this DPA controls** for data-protection matters.

### 2. Definitions

Capitalized terms not defined here have the meanings set out in the Main Contract or in the GDPR.

- **'Client'** – the legal entity accepting the Main Contract (regardless of subscription tier).
- **'Solution'** – the hosted Langfuse platform and any associated support or professional service.
- **'Client Personal Data'** – the subset of 'Client Data' that constitutes personal data processed by Langfuse on behalf of Client via the Solution.
- **'EU Cloud' / 'US Cloud' /'HIPAA Cloud'** – the regional instance selected by Client. **Client is responsible for selecting the instance that satisfies its applicable data-protection obligations.**
- **'Affiliate'** - any entity that controls, is controlled by, or is under common control with a party.
- **'De-Identified Data'** means data that cannot reasonably identify a natural person, Client, or Client account, taking into account reasonable technical and organizational measures.
- **'Controller'** and **'Processor'** – have the meanings given in the Applicable Data-Protection Laws; Client is the Controller of Client Personal Data and Langfuse is the Processor.
- **'Applicable Data-Protection Laws'** – the EU GDPR, UK GDPR, CCPA, and any other applicable national or U.S. state data-protection laws.

### 3. Scope, Instructions & Responsibilities

Langfuse will Process Client Personal Data **only**:
(i) to provide, maintain, secure and support the Solution for Client,
(ii) as documented in this DPA and the Main Contract, and
(iii) to comply with law or Client's documented instructions.

Processing continues for the term of the Main Contract **and** until deletion of Client Personal Data in accordance with Section 9 (*Deletion & Return*).

Langfuse may use Solution-Generated Data (i.e. data that cannot reasonably identify a natural person, Client, or Client account) to operate, analyze, and improve the Solution. Langfuse will not sell Client Personal Data to third parties and will not use Client Personal Data to train AI models or for advertising.

**Processing on documented instructions.** Langfuse will process Client Personal Data **solely on documented instructions from Client**, unless Union or Member-State law to which Langfuse is subject requires other processing.

**Client responsibilities.** Client is responsible for (a) ensuring that its instructions are lawful and that a valid legal basis exists for all Processing; (b) the accuracy, quality and legality of Client Personal Data; and (c) fulfilling controller obligations under Articles 33–36 GDPR.

### 4. Sub-Processors

1. **Authorised List.** The current list of authorised sub-processors for each instance of Langfuse is published at: https://langfuse.com/security/subprocessors
2. **Affiliates.** Client authorizes Langfuse to engage its Affiliates as sub-processors subject to written agreements imposing data-protection obligations no less protective than this DPA.
3. **Notification & Objection.** Langfuse will notify Client (via email) at least **30 days** before authorising a new sub-processor. Client may object on reasonable data-protection grounds within that period.
4. **Data-Transfer Mechanisms.** Transfers to sub-processors outside the EEA/UK/Switzerland will rely on an approved transfer mechanism (e.g. EU SCCs, UK IDTA, or participation in the EU–US Data Privacy Framework).
5. **Same obligations & responsibility.** Langfuse shall ensure each Sub-Processor is bound by a written agreement that imposes the same data-protection obligations as set out in Article 28(3) GDPR.

### 5. Security Measures

Langfuse will implement and maintain the technical and organisational measures ('TOMs') described in **Annex 2** (as updated from time to time). Material reductions will not be implemented without reasonable notice to Client.

**Personnel confidentiality.** All Langfuse employees and other recipients and subprocessor personnel who have access to Client Personal Data are bound by written confidentiality agreements or statutory duties of confidentiality **and receive regular privacy and security training appropriate to their role**.

Langfuse maintains **ISO 27001** and **SOC 2 Type II** attestations.

### 6. Data Subject Rights & Regulatory Cooperation

Langfuse shall provide reasonable assistance (taking into account the nature of Processing and information available) for Client to respond to Data Subject requests or supervisory authority enquiries.

Taking into account the nature of Processing and the information available to Langfuse, Langfuse will provide reasonable assistance to Client in ensuring compliance with Articles 32–36 GDPR, including by providing available information about its Processing operations and TOMs to support data protection impact assessments (DPIAs).

### 7. Security Incidents & Regulatory Support

Upon becoming aware of a Security Incident affecting Client Personal Data, Langfuse will notify Client **without undue delay** (and in no event later than 72 hours). Where required, Langfuse will provide information sufficient to allow Client to meet its regulatory obligations.

Langfuse will provide reasonable assistance for Client to notify data-protection authorities or affected data subjects (e.g. in accordance with Articles 33 and 34 GDPR).

### 8. Audits

**Third-Party Reports:** Annual SOC 2 (Type II) or ISO 27001 certificates shall ordinarily satisfy Client's audit rights to the extent permitted by Data Protection Laws.

**Additional audits:** Only if required by an authority, a material issue, or if the reports do not provide sufficient evidence of Langfuse's compliance with this DPA. These audits must be strictly scoped and subject to: (i) at least 30 days' prior written notice, (ii) reasonable confidentiality and security safeguards, and (iii) a limit of one on-site audit in any rolling 12-month period.

### 9. Deletion & Return of Data

**Deletion requests during the Term.** Where the Solution includes self-service deletion or data-redaction features, Client shall use those features to delete Client Personal Data.

**Deletion after termination.** No later than **30 days** following termination of the Main Contract (or earlier upon written request), Langfuse will delete or return (and thereafter delete) Client Personal Data, unless retention is required by law.

Langfuse may retain copies of Client Personal Data **(a)** in secure back-up archives that are isolated from active systems and **(b)** as strictly necessary for the establishment, exercise or defence of legal claims.

### 10. International Transfers

Langfuse will implement an appropriate transfer mechanism for each transfer, including the EU SCCs (Decision 2021/914) using Module 2 and/or Module 3 as applicable; the UK IDTA/Addendum; and the Swiss addendum.

Data processed in the **EU Cloud** remains within the EEA (or equivalent adequacy jurisdictions) by default.

Data processed in the **US Cloud** is primarily hosted in the United States; Langfuse relies on the EU Standard Contractual Clauses (Module 2 and/or 3) and/or the EU–US Data Privacy Framework for such transfers.

Data processed in **HIPAA Cloud**: PHI is hosted in a dedicated, HIPAA-compliant environment in the United States.

### 11. Main Contract Governance

**Indemnity & Liability**: Each party's aggregate liability and indemnities relating to Processing are governed by the Main Contract.

**Governing Law:** The governing law and forum/venue for any dispute arising out of or relating to this DPA are the same as those specified in the Main Contract (currently either California, San Francisco courts, or Berlin, Germany courts).

**Precedence:** If there is a conflict on the same subject matter: (1) for PHI, the BAA controls; (2) for Personal Data (excluding PHI), the DPA controls; otherwise, the T&Cs control.

**Termination:** This DPA is coterminous with the Main Contract.

### 12. Changes to this DPA

Langfuse may modify this DPA from time to time to reflect changes in applicable law, new Solutions or practices and/or updated transfer clauses.

Langfuse will provide at least 30 days' notice (via email) of any modification. Continued use of the Solution after the notice period constitutes acceptance.

### 13. Notices

**Method of notice.** All legal notices under this DPA are to be sent (i) to Client at the primary email address associated with the account, and (ii) to Langfuse at legal@langfuse.com.

### Execution

**Acceptance & execution.** This DPA is incorporated into the Main Contract and becomes effective upon the Parties' execution of the Main Contract or an Order Form (including via a legally valid electronic signature or click-accept).

**Optional countersignature.** Upon Client's written request, Langfuse will provide a countersigned copy of this DPA for record-keeping.

### Annex 1 – Details of Processing

| Item | Description |
|------|-------------|
| Purpose of processing | Contractual provision of the Langfuse platform |
| Scope of processing | Processing necessary to provide, secure, support, maintain and improve the Solution |
| Types of personal data | Names, email addresses and other identifiers of Client's users; Application content, prompts/outputs, traces, logs and identifiers provided by Client (collectively 'Client Personal Data') |
| Categories of data subjects | Client's employees and other users ('users'); Individuals referenced in communication content ('data subjects of the Client') |
| Special Categories / Sensitive Data | Client will not submit Special Categories of Personal Data (GDPR Arts. 9–10) or Sensitive Personal Information under CPRA/CCPA to non-HIPAA environments. For HIPAA workloads, PHI may be processed only in the HIPAA Cloud under the BAA. |

### Annex 2 – Technical and Organisational Measures (TOMs)

The TOMs can be found at https://langfuse.com/security/toms

### Annex 3 – Subprocessors

A current list of Langfuse's subprocessors can be found at https://langfuse.com/security/subprocessors

### Annex 4 – International Transfer Pack (EU SCCs + UK & Swiss Addenda)

#### 4.1 Incorporation and Application of EU SCCs

**(a) Incorporation.** The Parties incorporate by reference the European Commission's Standard Contractual Clauses for the transfer of personal data to third countries under the GDPR, set out in Commission Implementing Decision (EU) 2021/914.

**(b) When they apply.** The EU SCCs apply only to the extent Client Personal Data is transferred from the EEA to a country without an adequacy decision.

**(c) Modules selected.**

- **Module 2 (Controller → Processor):** Selected where Client (as controller/data exporter) transfers to Langfuse (as processor/data importer) outside the EEA.
- **Module 3 (Processor → Sub-processor):** Selected for transfers from Langfuse (as processor/data exporter) to its sub-processors (data importers) outside the EEA.

**(d) Options and clause selections.**

- **Clause 7 (Docking clause):** Included.
- **Clause 9(a) (Use of sub-processors):** Option 2 (General written authorisation); notice period: 30 days.
- **Clause 13 (Supervisory authority):** As determined by Clause 13 for the data exporter.
- **Clause 17 (Governing law):** German law.
- **Clause 18 (Forum and jurisdiction):** Courts of Berlin, Germany.

#### 4.5 UK Addendum (UK GDPR)

For restricted transfers under the UK GDPR, the Parties incorporate by reference the UK Information Commissioner's International Data Transfer Addendum to the EU SCCs (Version B1.0, in force 21 March 2022) (the 'UK Addendum').

#### 4.6 Swiss Addendum (FADP)

For transfers subject to Swiss data protection law, the Parties agree the EU SCCs are adapted as follows:

1. References to the 'GDPR' include the FADP where applicable; references to 'Member State' include Switzerland.
2. For Swiss-subject transfers, Clauses 17–18 are governed by Swiss law and the courts of Zurich, Switzerland.
3. Swiss data subjects may exercise third-party beneficiary rights in Switzerland under the SCCs as adapted.

---

## Subprocessors

Langfuse (Langfuse GmbH) uses the following subprocessors to provide our services.

### Affiliates

| Company | Purpose | Type of Data | Categories of Data Subjects | Location of Data Processing |
|---------|---------|--------------|----------------------------|----------------------------|
| Finto Technologies Inc., 156, 2nd Street, 94105, San Francisco, California, USA (100% parent company of Langfuse GmbH) | Servicing & Support | Client Data | Affected individuals of the client | US |

### Langfuse Cloud: EU

`cloud.langfuse.com`

| Company | Purpose | Type of Data | Categories of Data Subjects | Location of Data Processing |
|---------|---------|--------------|----------------------------|----------------------------|
| Amazon Web Services, Inc. | Application Hosting | Client Data | Affected individuals of the client | EU |
| Clickhouse Inc. | Application Hosting | Client Data | Affected individuals of the client | EU |
| Google LLC | Application Hosting | Client Data | Affected individuals of the client | EU |
| Posthog, Inc. | Product metrics | Client Data | Affected individuals of the client | EU |
| Datadog, Inc. | Application logs | Client Data | Affected individuals of the client | EU |
| Cloudflare, Inc. | Web Application Security (e.g. Firewall, DDOS protection) | Client Data | Affected individuals of the client | Global Edge |
| Functional Software, Inc. d/b/a Sentry | Application logs | Client Data | Affected individuals of the client | EU |

### Langfuse Cloud: US

`us.cloud.langfuse.com`

| Company | Purpose | Type of Data | Categories of Data Subjects | Location of Data Processing |
|---------|---------|--------------|----------------------------|----------------------------|
| Amazon Web Services, Inc. | Application Hosting | Client Data | Affected individuals of the client | US |
| Clickhouse Inc. | Application Hosting | Client Data | Affected individuals of the client | US |
| Google LLC | Product Metrics, Support, Servicing Contract | Client Data | Affected individuals of the client | EU |
| Posthog, Inc. | Product metrics | Client Data | Affected individuals of the client | EU |
| Datadog, Inc. | Application logs | Client Data | Affected individuals of the client | US |
| Cloudflare, Inc. | Web Application Security (e.g. Firewall, DDOS protection) | Client Data | Affected individuals of the client | Global Edge |
| Functional Software, Inc. d/b/a Sentry | Application logs | Client Data | Affected individuals of the client | US |

### Langfuse HIPAA: US

`hipaa.cloud.langfuse.com`

The HIPAA-compliant US region is hosted in the US and is subject to the same subprocessors as the US region. PHI data is only stored and processed by the following subset of subprocessors:

| Company | Purpose | Type of Data | Categories of Data Subjects | Location of Data Processing |
|---------|---------|--------------|----------------------------|----------------------------|
| Amazon Web Services, Inc. | Application Hosting | PHI | Affected individuals of the client | US |
| Clickhouse Inc. | Application Hosting | PHI | Affected individuals of the client | US |
