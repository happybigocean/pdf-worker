export const schema = {
  type: "OBJECT",
  properties: {
    documentInfo: {
      type: "OBJECT",
      properties: {
        schemaVersion: { type: "STRING" },
        documentType: { type: "STRING" },
        documentPurpose: { type: "STRING" },
        isOfficial: {
          type: "BOOLEAN",
          description: "Whether this is marked as an official or unofficial transcript"
        },
        issueDate: { type: "STRING" },
        validUntil: { type: "STRING" },
        language: { type: "STRING" },
        registrar: { type: "STRING" },
        registrarTitle: { type: "STRING" },
        documentId: { type: "STRING" }
      },
      required: ["documentType"]
    },
    verification: {
      type: "OBJECT",
      description: "Authentication metadata",
      properties: {
        verificationStatus: {
          type: "STRING",
          enum: ["pending", "verified", "rejected", "suspected", "unknown"]
        },
        verificationMethod: {
          type: "STRING",
          enum: [
            "digital_signature", "email_institution", "blockchain",
            "official_website", "third_party_service", "paper_seal",
            "watermark", "hologram", "secure_paper", "manual_review",
            "registrar_confirmation", "other"
          ]
        },
        securityFeatures: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              type: {
                type: "STRING",
                enum: [
                  "watermark", "hologram", "seal", "signature",
                  "secure_paper", "qr_code", "barcode", "other"
                ]
              },
              verified: { type: "BOOLEAN" },
              notes: { type: "STRING" }
            }
          }
        },
        verificationDate: { type: "STRING", format: "date-time" },
        verificationNotes: { type: "STRING" },
        blockchainTxId: { type: "STRING" },
        verificationCode: { type: "STRING" },
        verifierName: { type: "STRING" },
        verifierTitle: { type: "STRING" },
        verifierInstitution: { type: "STRING" }
      }
    },
    studentInfo: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        firstName: { type: "STRING" },
        middleName: { type: "STRING" },
        lastName: { type: "STRING" },
        preferredName: { type: "STRING" },
        address_info: {
          type: "OBJECT",
          required: ["city", "country"],
          properties: {
            street: { type: "STRING" },
            street2: { type: "STRING" },
            city: { type: "STRING" },
            state: { type: "STRING" },
            postalCode: { type: "STRING", pattern: "^[A-Z0-9-\\s]{3,10}$" },
            country: { type: "STRING" }
          }
        },
        email: { type: "STRING" }
      },
      required: ["firstName", "lastName"]
    },
    institutionInfo: {
      type: "OBJECT",
      properties: {
        institutionAdderss: {
          type: "OBJECT",
          required: ["city", "country"],
          properties: {
            street: { type: "STRING" },
            street2: { type: "STRING" },
            city: { type: "STRING" },
            state: { type: "STRING" },
            postalCode: { type: "STRING", pattern: "^[A-Z0-9-\\s]{3,10}$" },
            country: { type: "STRING" }
          }
        },
        name: { type: "STRING" },
        scale: { type: "STRING" },
        gradingSystem: {
          type: "OBJECT",
          properties: {
            scale: { type: "STRING" },
            gpaCalculation: { type: "STRING" },
            academicStandingPolicy: { type: "STRING" }
          }
        }
      },
      required: ["name"]
    },
    academicInfo: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          level: { type: "STRING" },
          degrees: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                degreeName: { type: "STRING" },
                degreeType: { type: "STRING" },
                major: { type: "ARRAY", items: { type: "STRING" } },
                minor: { type: "ARRAY", items: { type: "STRING" } },
                conferralDate: { type: "STRING" },
                gpa: { type: "NUMBER" }
              }
            }
          }
        },
        required: ["degrees"]
      }
    },
    terms: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          termId: { type: "STRING" },
          term: { type: "STRING" },
          termType: { type: "STRING" },
          termYear: { type: "NUMBER" },
          startDate: { type: "STRING" },
          endDate: { type: "STRING" },
          academicStanding: { type: "STRING" },
          termGpa: { type: "NUMBER" },
          termCreditsAttempted: { type: "NUMBER" },
          termCreditsEarned: { type: "NUMBER" },
          termGradePoints: { type: "NUMBER" },
          courses: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                courseCode: { type: "STRING" },
                courseTitle: { type: "STRING" },
                grade: { type: "STRING" },
                gradePoints: { type: "NUMBER" },
                creditsAttempted: { type: "NUMBER" },
                creditsEarned: { type: "NUMBER" },
                courseLevel: { type: "STRING" },
                repeatCode: { type: "STRING" },
                deliveryMode: { type: "STRING" },
                gradingBasis: { type: "STRING" }
              },
              required: ["courseCode", "courseTitle", "grade"]
            }
          }
        },
        required: ["termType", "termYear", "courses"]
      }
    },
    cumulativeSummary: {
      type: "OBJECT",
      properties: {
        overallGPA: { type: "NUMBER" },
        totalCreditsAttempted: { type: "NUMBER" },
        totalCreditsEarned: { type: "NUMBER" },
        totalGPACredits: { type: "NUMBER" },
        totalGradePoints: { type: "NUMBER" },
        totalCreditsTransferred: { type: "NUMBER" },
        classRank: {
          type: "OBJECT",
          properties: {
            rank: { type: "NUMBER" },
            outOf: { type: "NUMBER" }
          }
        }
      }
    },
    transferCredits: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          institutionName: { type: "STRING" },
          term: { type: "STRING" },
          transferGPA: { type: "NUMBER" },
          totalCredits: { type: "NUMBER" },
          transferredCourses: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                originalCourse: {
                  type: "OBJECT",
                  properties: {
                    courseCode: { type: "STRING" },
                    courseTitle: { type: "STRING" },
                    grade: { type: "STRING" },
                    credits: { type: "NUMBER" }
                  },
                  required: ["courseCode", "courseTitle"]
                }
              }
            }
          }
        }
      }
    }
  },
  required: ["studentInfo", "institutionInfo", "terms"]
};
