import type { HuntPreferencesData } from "@workspace/db";

export interface Preset {
  id: string;
  title: string;
  description: string;
  preferences: HuntPreferencesData;
  /** Showcase presets also exist as public, read-only hunts that refresh on a schedule. */
  showcase: boolean;
}

const base: HuntPreferencesData = {
  roles: [],
  keywords: [],
  excludeKeywords: [],
  locations: [],
  remoteOk: false,
  seniority: ["internship"],
  opportunityTypes: ["company_roles"],
  needsVisaSponsorship: false,
  citizenship: null,
  funding: "any",
  companies: [],
};

export const PRESETS: Preset[] = [
  {
    id: "funded-research-abroad",
    title: "Fully funded research internships abroad",
    description:
      "Summer research programs and lab internships in Germany, Canada, Japan and Switzerland that pay a stipend and cover travel or housing, open to students from India.",
    showcase: true,
    preferences: {
      ...base,
      roles: ["Machine Learning Research", "Computer Science Research"],
      locations: ["Germany", "Canada", "Japan", "Switzerland"],
      opportunityTypes: ["research_programs", "company_roles"],
      needsVisaSponsorship: true,
      citizenship: "India",
      funding: "fully_funded",
    },
  },
  {
    id: "swe-intern-visa",
    title: "Software engineering internships with visa sponsorship",
    description:
      "Paid software engineering internships in the US, UK and the Netherlands at companies that sponsor visas, including Stripe and Atlassian.",
    showcase: true,
    preferences: {
      ...base,
      roles: ["Software Engineer", "Backend Engineer"],
      locations: ["United States", "United Kingdom", "Netherlands"],
      needsVisaSponsorship: true,
      citizenship: "India",
      funding: "paid",
      excludeKeywords: ["PhD"],
      companies: ["Stripe", "Atlassian"],
    },
  },
  {
    id: "new-grad-ml-europe",
    title: "New-grad machine learning roles in Europe or remote",
    description: "Entry-level ML engineer and data scientist roles in Berlin, Amsterdam, London or remote.",
    showcase: false,
    preferences: {
      ...base,
      roles: ["Machine Learning Engineer", "Data Scientist"],
      seniority: ["new_grad", "entry_level"],
      locations: ["Berlin", "Amsterdam", "London"],
      remoteOk: true,
      keywords: ["PyTorch"],
    },
  },
  {
    id: "us-summer-research",
    title: "Summer research programs in the US",
    description:
      "Funded undergraduate summer research in robotics and computer vision at US universities and labs that accept international applicants.",
    showcase: false,
    preferences: {
      ...base,
      roles: ["Robotics Research", "Computer Vision Research"],
      locations: ["United States"],
      opportunityTypes: ["research_programs"],
      needsVisaSponsorship: true,
      citizenship: "India",
      funding: "fully_funded",
    },
  },
];
